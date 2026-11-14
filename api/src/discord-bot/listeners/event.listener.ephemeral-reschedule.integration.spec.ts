/**
 * ROK-2201 — integration (real Postgres, Discord client faked): when an event's
 * start moves past the temp-voice create window, the UPDATED listener releases
 * the EMPTY channel and clears `ephemeral_voice_channel_id` so the create-window
 * cron recreates it before the new start. An occupied channel stays, and a start
 * still inside the window leaves the channel alone (operator ruling).
 *
 * Fakes: `isConnected`/`getGuild` on the bot client (no Discord in the test
 * app — precedent lineups.integration.spec.ts), the SE sync and the embed post
 * (both out of scope here; their Discord calls would otherwise no-op or throw).
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { EmbedPosterService } from '../services/embed-poster.service';
import { DiscordEventListener, type EventPayload } from './event.listener';

const CHANNEL_ID = 'eph-vc-2201';
type Guild = ReturnType<DiscordBotClientService['getGuild']>;

describe('event UPDATED releases a temp voice channel past the window (ROK-2201)', () => {
  let app: TestApp;
  let listener: DiscordEventListener;
  let deleteChannel: jest.Mock;

  beforeAll(async () => {
    app = await getTestApp();
    listener = app.app.get(DiscordEventListener);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    app.seed = await truncateAllTables(app.db);
  });

  /** Fake guild holding one voice channel with `members` people in it. */
  function stubDiscord(members: number): void {
    deleteChannel = jest.fn().mockResolvedValue(undefined);
    const channel = {
      id: CHANNEL_ID,
      name: '⏰ Ephemeral Test',
      isVoiceBased: () => true,
      members: { size: members },
    };
    const guild = {
      id: 'guild-2201',
      channels: {
        cache: new Map([[CHANNEL_ID, channel]]),
        delete: deleteChannel,
        fetch: jest.fn().mockResolvedValue(null),
      },
    };
    const client = app.app.get(DiscordBotClientService);
    jest.spyOn(client, 'isConnected').mockReturnValue(true);
    jest.spyOn(client, 'getGuild').mockReturnValue(guild as unknown as Guild);
    jest
      .spyOn(app.app.get(ScheduledEventService), 'updateScheduledEvent')
      .mockResolvedValue(undefined);
    jest
      .spyOn(app.app.get(EmbedPosterService), 'postEmbed')
      .mockResolvedValue(false);
  }

  /** Event that already holds the temp channel, now starting `startMin` out. */
  async function insertEventWithChannel(startMin: number): Promise<number> {
    const start = new Date(Date.now() + startMin * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const [row] = nonEmpty(
      await app.db
        .insert(schema.events)
        .values({
          title: 'Ephemeral Test',
          creatorId: app.seed.adminUser.id,
          gameId: app.seed.game.id,
          duration: [start, end],
          ephemeralVoiceChannelId: CHANNEL_ID,
        } as never)
        .returning({ id: schema.events.id }),
      'event',
    );
    return row.id;
  }

  async function fireUpdated(eventId: number): Promise<void> {
    const [ev] = nonEmpty(
      await app.db
        .select({ title: schema.events.title })
        .from(schema.events)
        .where(eq(schema.events.id, eventId)),
      'event row',
    );
    const payload: EventPayload = {
      eventId,
      event: {
        id: eventId,
        title: ev.title,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        signupCount: 0,
      },
    };
    await listener.handleEventUpdated(payload);
  }

  async function storedChannelId(eventId: number): Promise<string | null> {
    const [row] = nonEmpty(
      await app.db
        .select({ id: schema.events.ephemeralVoiceChannelId })
        .from(schema.events)
        .where(eq(schema.events.id, eventId)),
      'event row',
    );
    return row.id;
  }

  it('deletes an EMPTY channel and clears the id when the start moved past the window', async () => {
    stubDiscord(0);
    const eventId = await insertEventWithChannel(120);

    await fireUpdated(eventId);

    expect(deleteChannel).toHaveBeenCalledWith(CHANNEL_ID);
    expect(await storedChannelId(eventId)).toBeNull();
  });

  it('keeps an OCCUPIED channel even though the start moved past the window', async () => {
    stubDiscord(2);
    const eventId = await insertEventWithChannel(120);

    await fireUpdated(eventId);

    expect(deleteChannel).not.toHaveBeenCalled();
    expect(await storedChannelId(eventId)).toBe(CHANNEL_ID);
  });

  it('keeps the channel when the moved start is still inside the window', async () => {
    stubDiscord(0);
    const eventId = await insertEventWithChannel(20);

    await fireUpdated(eventId);

    expect(deleteChannel).not.toHaveBeenCalled();
    expect(await storedChannelId(eventId)).toBe(CHANNEL_ID);
  });
});
