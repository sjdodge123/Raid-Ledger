/**
 * ROK-1389 — TDD failing tests: series event registered against the wrong voice
 * channel. The channel→event and event→channel resolvers disagree, so a series
 * voice channel never maps to the series instance whose weekly gameId differs
 * from the voice binding's stored gameId. That single mismatch cascades into
 * attendance tracking, reminder suppression, and end-of-event classification.
 *
 * Fixture (from the spec's Test plan):
 *   - games A and B
 *   - series group R with ONE live instance whose gameId = B
 *   - a series voice binding {voice, game-voice-monitor, game_id = A (≠ B),
 *     recurrence_group_id = R} on channel VOICE1
 *   - a series text announce binding {text, game-announcements, group R} on TEXT1
 *   - default voice channel = GENERAL
 *
 * CRITICAL fixture note (spec): the resolver tiers consult
 * `clientService.getGuildId()`, which returns null in the integration app (no
 * Discord connection) and would silently skip Tiers 1-2. We `jest.spyOn` it —
 * precedent: recruitment-reminder.service.bindings-change.integration.spec.ts:55-56.
 *
 * TDD colors (spec table):
 *   i     RED   — findActive misses the instance (gameId filter excludes it)
 *   ii    GREEN — resolveVoiceChannelForScheduledEvent Tier-1 hits (regression pin)
 *   iii   GREEN — notification resolveVoiceChannelForEvent, no override (pin)
 *   iii-b RED   — override to a TEXT channel is returned unconditionally today
 *   iv    RED   — no-show list keeps an in-voice player absent (depends on i)
 *   v     RED   — classify finds 0 tracked sessions (depends on i)
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { VoiceAttendanceService } from './services/voice-attendance.service';
import { ChannelResolverService } from './services/channel-resolver.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationService } from '../notifications/notification.service';
import { getAbsentSignedUpPlayers } from '../notifications/live-noshow.helpers';

const GUILD = 'guild-1389';
const SERIES_R = '1389aaaa-1111-2222-3333-444444444444';
const VOICE1 = 'voice-channel-1389';
const TEXT1 = 'text-channel-1389';
const GENERAL = 'general-voice-1389';

let testApp: TestApp;
let voiceAttendance: VoiceAttendanceService;
let channelResolver: ChannelResolverService;
let notificationService: NotificationService;
let discordBotClient: DiscordBotClientService;
let settingsService: SettingsService;

/**
 * Fake guild whose channel cache reports VOICE1 as voice-based and TEXT1 as
 * text-based, so the (future) override voice-ness guard can distinguish them.
 * On main this is never consulted — the override is returned unconditionally.
 */
function makeFakeGuild() {
  const cache = new Map<string, { isVoiceBased: () => boolean }>([
    [VOICE1, { isVoiceBased: () => true }],
    [TEXT1, { isVoiceBased: () => false }],
  ]);
  return { id: GUILD, channels: { cache } };
}

/** Seed games A+B, the live series instance (gameId=B), and both bindings. */
async function seedAgreementFixture(): Promise<{
  eventId: number;
  gameAId: number;
  gameBId: number;
}> {
  const [gameA] = await testApp.db
    .insert(schema.games)
    .values({ name: 'Game A 1389', slug: 'game-a-1389', igdbId: null })
    .returning();
  const [gameB] = await testApp.db
    .insert(schema.games)
    .values({ name: 'Game B 1389', slug: 'game-b-1389', igdbId: null })
    .returning();

  const now = Date.now();
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Series raid 1389',
      creatorId: testApp.seed.adminUser.id,
      gameId: gameB.id,
      recurrenceGroupId: SERIES_R,
      duration: [new Date(now - 60 * 60 * 1000), new Date(now + 2 * 60 * 60 * 1000)] as [Date, Date],
      maxAttendees: 20,
    })
    .returning();

  // Series voice binding carries the pre-ROK-1372 shape: game-voice-monitor +
  // stored gameId = A, which differs from this week's instance gameId = B.
  await testApp.db.insert(schema.channelBindings).values({
    guildId: GUILD,
    channelId: VOICE1,
    channelType: 'voice',
    bindingPurpose: 'game-voice-monitor',
    gameId: gameA.id,
    recurrenceGroupId: SERIES_R,
  });
  await testApp.db.insert(schema.channelBindings).values({
    guildId: GUILD,
    channelId: TEXT1,
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameId: gameB.id,
    recurrenceGroupId: SERIES_R,
  });

  return { eventId: event.id, gameAId: gameA.id, gameBId: gameB.id };
}

/** Insert a non-bench, signed-up anonymous Discord signup for the event. */
async function seedSignup(eventId: number, discordUserId: string): Promise<void> {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    discordUserId,
    discordUsername: discordUserId,
    status: 'signed_up',
  });
}

/** Simulate a voice join through the REAL pipeline (findActive → handleJoin). */
async function joinThroughPipeline(discordUserId: string): Promise<void> {
  const active = await voiceAttendance.findActiveScheduledEvents(VOICE1);
  for (const { eventId } of active) {
    voiceAttendance.handleJoin(eventId, discordUserId, discordUserId, null);
  }
}

beforeAll(async () => {
  testApp = await getTestApp();
  voiceAttendance = testApp.app.get(VoiceAttendanceService);
  channelResolver = testApp.app.get(ChannelResolverService);
  notificationService = testApp.app.get(NotificationService);
  discordBotClient = testApp.app.get(DiscordBotClientService);
  settingsService = testApp.app.get(SettingsService);
});

beforeEach(async () => {
  jest.spyOn(discordBotClient, 'getGuildId').mockReturnValue(GUILD);
  jest
    .spyOn(discordBotClient, 'getGuild')
    .mockReturnValue(makeFakeGuild() as never);
  await settingsService.set(
    schema.SETTING_KEYS.DISCORD_BOT_DEFAULT_VOICE_CHANNEL,
    GENERAL,
  );
});

afterEach(async () => {
  jest.restoreAllMocks();
  // Reset the singleton in-memory session map so a join from one test cannot
  // leak into the next (event ids are unique, but a stale dirty session would
  // otherwise try to flush against a now-deleted event id).
  (voiceAttendance as unknown as { sessions: Map<string, unknown> }).sessions.clear();
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-1389 — voice-channel agreement (integration)', () => {
  // Case i (RED): the channel→event resolver must map VOICE1 to the live
  // instance even though its gameId (B) differs from the binding's gameId (A).
  it('i: findActiveEventsForChannel(VOICE1) returns the live series instance', async () => {
    const { eventId } = await seedAgreementFixture();

    const active = await voiceAttendance.findActiveScheduledEvents(VOICE1);

    expect(active.map((e) => e.eventId)).toContain(eventId);
  });

  // Case ii (GREEN pin): the event→channel resolver Tier-1 series voice binding
  // already resolves VOICE1 for (gameId=B, group=R). Lock it against regression.
  it('ii: resolveVoiceChannelForScheduledEvent(B, R) === VOICE1', async () => {
    const { gameBId } = await seedAgreementFixture();

    const resolved = await channelResolver.resolveVoiceChannelForScheduledEvent(
      gameBId,
      SERIES_R,
      null,
    );

    expect(resolved).toBe(VOICE1);
  });

  // Case iii (GREEN pin): the notification deep-link resolver, with NO override,
  // resolves the same VOICE1 via the event's stored gameId + recurrence group.
  it('iii: notification resolveVoiceChannelForEvent === VOICE1 (no override)', async () => {
    const { eventId } = await seedAgreementFixture();

    const resolved =
      await notificationService.resolveVoiceChannelForEvent(eventId);

    expect(resolved).toBe(VOICE1);
  });

  // Case iii-b (RED): an override pointing at a TEXT channel must NOT win — the
  // guild cache says TEXT1 is text-based, so resolution must fall through to the
  // series voice binding (VOICE1). Today the override is returned unconditionally.
  it('iii-b: text-channel override does NOT override the voice resolution', async () => {
    const { eventId } = await seedAgreementFixture();
    await testApp.db
      .update(schema.events)
      .set({ notificationChannelOverride: TEXT1 })
      .where(eq(schema.events.id, eventId));

    const resolved =
      await notificationService.resolveVoiceChannelForEvent(eventId);

    expect(resolved).toBe(VOICE1);
  });

  // Case iv (RED, depends on i): once the in-voice player is tracked, the
  // no-show scan must exclude them and keep the genuinely-absent player.
  it('iv: getAbsentSignedUpPlayers excludes the in-voice player, keeps the absent one', async () => {
    const { eventId } = await seedAgreementFixture();
    const inVoice = 'discord-in-voice-1389';
    const absent = 'discord-absent-1389';
    await seedSignup(eventId, inVoice);
    await seedSignup(eventId, absent);

    await joinThroughPipeline(inVoice);

    const absentPlayers = await getAbsentSignedUpPlayers(
      testApp.db,
      eventId,
      (eid, did) => voiceAttendance.isUserActive(eid, did),
    );
    const absentIds = absentPlayers.map((p) => p.discordUserId);
    expect(absentIds).not.toContain(inVoice);
    expect(absentIds).toContain(absent);
  });

  // Case v (RED, depends on i): the flush→classify pipeline must record a real
  // tracked session for the joined player, not "Classified 0 voice session(s)".
  it('v: flush + classify yields at least one tracked voice session', async () => {
    const { eventId } = await seedAgreementFixture();
    const joiner = 'discord-joiner-1389';
    await seedSignup(eventId, joiner);

    await joinThroughPipeline(joiner);
    voiceAttendance.handleLeave(eventId, joiner);
    await voiceAttendance.flushToDb();

    // classifyEventSessions loads exactly the rows present after flush; on main
    // there are none because the join never mapped to the event.
    const flushed = await testApp.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));
    expect(flushed.length).toBeGreaterThanOrEqual(1);
    expect(flushed.some((r) => r.discordUserId === joiner)).toBe(true);

    await voiceAttendance.classifyEvent(eventId);

    // A real tracked session has a non-empty segments array; a synthesized
    // no_show row has segments = []. At least one real session must survive.
    const after = await testApp.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));
    const tracked = after.filter(
      (r) => Array.isArray(r.segments) && r.segments.length > 0,
    );
    expect(tracked.length).toBeGreaterThanOrEqual(1);
  });
});
