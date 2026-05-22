/**
 * ROK-1335 — Failing integration test reproducing the operator's incident:
 * a recruitment "spots still available" channel bump posted by
 * `RecruitmentReminderService.postChannelBump()` must follow the CURRENT
 * channel bindings, not the channel ID frozen on `discord_event_messages`
 * at initial-post time.
 *
 * Setup mirrors the prod scenario:
 *   - event created when bindings pointed at CHANNEL_A
 *   - `discord_event_messages.channel_id` was therefore stored as CHANNEL_A
 *   - operator later rebinds the game to CHANNEL_B
 *   - 24-48h before start, the recruitment cron fires
 *
 * On origin/main: `postChannelBump()` calls
 * `discordBotClient.sendEmbed(event.channelId, …)` which is CHANNEL_A,
 * so the assertion that `sendEmbed` was called with CHANNEL_B fails.
 *
 * After the dev wires `ChannelResolverService.resolveChannelForEvent(...)`
 * into `postChannelBump()` (per the spec), the resolver returns CHANNEL_B
 * (game-binding match), `sendEmbed` is called with CHANNEL_B, and this
 * test passes.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { RecruitmentReminderService } from './recruitment-reminder.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';

const TEST_GUILD_ID = 'guild-test-1335';
const CHANNEL_A = 'channel-stale-A';
const CHANNEL_B = 'channel-current-B';

let testApp: TestApp;
let service: RecruitmentReminderService;
let discordBotClient: DiscordBotClientService;
let sendEmbedSpy: jest.SpyInstance;
let isConnectedSpy: jest.SpyInstance;
let getGuildIdSpy: jest.SpyInstance;

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(RecruitmentReminderService);
  discordBotClient = testApp.app.get(DiscordBotClientService);
});

beforeEach(() => {
  // Bot is not actually connected in integration tests, so stub the three
  // surfaces postChannelBump + ChannelResolverService consult. We do NOT
  // stub the resolver itself — the resolver runs end-to-end against the
  // real channel_bindings rows seeded below, so we exercise the wiring
  // AND the resolver query.
  isConnectedSpy = jest
    .spyOn(discordBotClient, 'isConnected')
    .mockReturnValue(true);
  getGuildIdSpy = jest
    .spyOn(discordBotClient, 'getGuildId')
    .mockReturnValue(TEST_GUILD_ID);
  sendEmbedSpy = jest
    .spyOn(discordBotClient, 'sendEmbed')
    .mockResolvedValue({ id: 'bump-msg-001' } as never);
});

afterEach(async () => {
  isConnectedSpy?.mockRestore();
  getGuildIdSpy?.mockRestore();
  sendEmbedSpy?.mockRestore();
  if (testApp) testApp.seed = await truncateAllTables(testApp.db);
});

/**
 * Seed: future event ~36h out for `seed.game`, with a
 * `discord_event_messages` row stored against CHANNEL_A (the channel the
 * embed was originally posted to), and a `channel_bindings` row that
 * currently routes the game to CHANNEL_B.
 *
 * `createdAt` is set 3 days in the past so the recruitment-reminder
 * grace-period / short-notice gates pass (gap >> 12h threshold).
 */
async function seedEventWithStaleChannel(): Promise<{ eventId: number }> {
  const gameId = testApp.seed.game.id;
  const creatorId = testApp.seed.adminUser.id;
  const start = new Date(Date.now() + 36 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Stale-channel raid',
      creatorId,
      gameId,
      duration: [start, end] as [Date, Date],
      maxAttendees: 20,
      createdAt,
    })
    .returning();

  await testApp.db.insert(schema.discordEventMessages).values({
    eventId: event.id,
    guildId: TEST_GUILD_ID,
    channelId: CHANNEL_A,
    messageId: 'msg-original-001',
    embedState: 'posted',
  });

  await testApp.db.insert(schema.channelBindings).values({
    guildId: TEST_GUILD_ID,
    channelId: CHANNEL_B,
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameId,
    recurrenceGroupId: null,
  });

  return { eventId: event.id };
}

describe('RecruitmentReminderService — bindings-change channel routing (ROK-1335)', () => {
  it('posts the recruitment bump to the CURRENT bound channel, not the channel stored at initial post time', async () => {
    const { eventId } = await seedEventWithStaleChannel();

    await service.checkAndSendReminders();

    expect(sendEmbedSpy).toHaveBeenCalledTimes(1);
    const [actualChannelId] = sendEmbedSpy.mock.calls[0];
    expect(actualChannelId).toBe(CHANNEL_B);
    expect(actualChannelId).not.toBe(CHANNEL_A);

    // The persistence write keeps using the original `event.channelId`
    // because `discord_event_messages` is keyed by where the original
    // embed went — the spec is explicit that the WHERE clause does NOT
    // change. We verify the row still exists with CHANNEL_A so a future
    // refactor that moves the persistence target along with the send
    // target trips a clear signal here.
    const [demRow] = await testApp.db
      .select()
      .from(schema.discordEventMessages);
    expect(demRow.eventId).toBe(eventId);
    expect(demRow.channelId).toBe(CHANNEL_A);
    // The bumpChannelId column records the channel the bump was ACTUALLY
    // posted to so EmbedSyncProcessor.maybeDeleteBumpMessage can target the
    // right channel for cleanup when bindings changed (Codex P2 follow-up).
    expect(demRow.bumpMessageId).toBe('bump-msg-001');
    expect(demRow.bumpChannelId).toBe(CHANNEL_B);
  });
});
