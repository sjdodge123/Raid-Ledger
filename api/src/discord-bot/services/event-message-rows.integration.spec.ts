/**
 * ROK-2292 R1 — integration (real Postgres, Discord client faked): a forum
 * post's starter row (`channel_id = message_id`) must never pass for the
 * announcement embed. Before the announcement posts, a starter row alone
 * leaves `hasEmbed` false (otherwise the scheduler never posts the
 * announcement) and yields no "View in Discord" link; event delete removes
 * the starter row from the DB but never deletes its Discord message (that
 * would delete the whole forum post).
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { hasPostedEmbed } from '../../notifications/hub-notification.queries';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEventListener } from '../listeners/event.listener';
import { EmbedPosterService } from './embed-poster.service';
import { ScheduledEventService } from './scheduled-event.service';
import { findAnnouncementMessage } from './event-message-rows.helpers';

const GUILD = 'guild-2292';
const THREAD = '1300000000000000001';
const ANNOUNCE_CHANNEL = '1300000000000000002';
const ANNOUNCE_MSG = '1300000000000000003';

describe('forum starter rows never stand in for the announcement (ROK-2292)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    app.seed = await truncateAllTables(app.db);
  });

  async function insertEvent(): Promise<number> {
    const start = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const [row] = nonEmpty(
      await app.db
        .insert(schema.events)
        .values({
          title: 'Forum Starter Test',
          creatorId: app.seed.adminUser.id,
          gameId: app.seed.game.id,
          duration: [start, end],
        })
        .returning({ id: schema.events.id }),
      'event',
    );
    return row.id;
  }

  async function insertRow(
    eventId: number,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await app.db
      .insert(schema.discordEventMessages)
      .values({ eventId, guildId: GUILD, channelId, messageId });
  }

  it('a starter row alone is not a posted announcement', async () => {
    const eventId = await insertEvent();
    await insertRow(eventId, THREAD, THREAD);

    expect(await app.app.get(EmbedPosterService).hasEmbed(eventId)).toBe(false);
    expect(await hasPostedEmbed(app.db, eventId)).toBe(false);
    expect(await findAnnouncementMessage(app.db, eventId)).toBeNull();
    expect(
      await app.app.get(NotificationService).getDiscordEmbedUrl(eventId),
    ).toBeNull();
  });

  it('with both rows, the readers return the announcement, never the starter', async () => {
    const eventId = await insertEvent();
    await insertRow(eventId, THREAD, THREAD);
    await insertRow(eventId, ANNOUNCE_CHANNEL, ANNOUNCE_MSG);

    expect(await app.app.get(EmbedPosterService).hasEmbed(eventId)).toBe(true);
    expect(await findAnnouncementMessage(app.db, eventId)).toEqual({
      guildId: GUILD,
      channelId: ANNOUNCE_CHANNEL,
      messageId: ANNOUNCE_MSG,
    });
    expect(
      await app.app.get(NotificationService).getDiscordEmbedUrl(eventId),
    ).toBe(
      `https://discord.com/channels/${GUILD}/${ANNOUNCE_CHANNEL}/${ANNOUNCE_MSG}`,
    );
  });

  it('event delete drops the starter row without deleting its Discord message', async () => {
    const eventId = await insertEvent();
    await insertRow(eventId, THREAD, THREAD);
    await insertRow(eventId, ANNOUNCE_CHANNEL, ANNOUNCE_MSG);
    const client = app.app.get(DiscordBotClientService);
    jest.spyOn(client, 'isConnected').mockReturnValue(true);
    jest.spyOn(client, 'getGuildId').mockReturnValue(GUILD);
    const deleteMessage = jest
      .spyOn(client, 'deleteMessage')
      .mockResolvedValue(undefined);
    jest
      .spyOn(app.app.get(ScheduledEventService), 'deleteScheduledEvent')
      .mockResolvedValue(undefined);

    await app.app.get(DiscordEventListener).handleEventDeleted({ eventId });

    expect(deleteMessage.mock.calls).toEqual([
      [ANNOUNCE_CHANNEL, ANNOUNCE_MSG],
    ]);
    const left = await app.db
      .select({ id: schema.discordEventMessages.id })
      .from(schema.discordEventMessages)
      .where(eq(schema.discordEventMessages.eventId, eventId));
    expect(left).toEqual([]);
  });
});
