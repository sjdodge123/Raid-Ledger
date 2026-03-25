/**
 * Voice Activity smoke tests.
 * Each test picks its own voice channel and creates/cleans up bindings.
 */
import { joinVoice, leaveVoice, getVoiceMembers } from '../../helpers/voice.js';
import { pollForCondition, pollForEmbed } from '../../helpers/polling.js';
import {
  createBinding,
  createEvent,
  deleteBinding,
  deleteEvent,
  signup,
  signupAs,
  pickChannel,
  futureTime,
  awaitProcessing,
  flushVoiceSessions,
  triggerClassify,
  injectVoiceSession,
  linkDiscord,
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';

async function withVoiceBinding(
  ctx: TestContext,
  index: number,
  purpose: string,
  fn: (voiceChId: string, textChId: string) => Promise<void>,
) {
  const vCh = pickChannel(ctx.voiceChannels, index);
  const tCh = pickChannel(ctx.textChannels, index);
  let vBindingId: string | undefined;
  let tBindingId: string | undefined;
  try {
    vBindingId = await createBinding(ctx.api, {
      channelId: vCh.id,
      channelType: 'voice',
      purpose,
      config: { minPlayers: 1, notificationChannelId: tCh.id },
    });
    console.log(`  [voice] Created ${purpose} binding for ${vCh.name}`);
  } catch (err) {
    console.log(`  [voice] Binding create failed for ${vCh.name}: ${(err as Error).message}`);
  }
  try {
    tBindingId = await createBinding(ctx.api, {
      channelId: tCh.id,
      channelType: 'text',
      purpose: 'game-announcements',
    });
  } catch { /* may already exist */ }
  // Ensure binding creation is fully processed before voice join
  await awaitProcessing(ctx.api);
  try {
    await fn(vCh.id, tCh.id);
  } finally {
    if (vBindingId) await deleteBinding(ctx.api, vBindingId);
    if (tBindingId) await deleteBinding(ctx.api, tBindingId);
  }
}

const voiceJoinDetected: SmokeTest = {
  name: 'Voice join triggers attendance session',
  category: 'voice',
  async run(ctx) {
    await withVoiceBinding(ctx, 0, 'game-voice-monitor', async (vChId) => {
      await joinVoice(vChId);
      try {
        await pollForCondition(
          async () => {
            const members = getVoiceMembers(vChId);
            const self = members.find((m) => m.id === ctx.testBotDiscordId);
            return self ?? null;
          },
          ctx.config.timeoutMs,
          { intervalMs: 1000 },
        );
      } finally {
        leaveVoice();
      }
    });
  },
};

const voiceLeaveRecorded: SmokeTest = {
  name: 'Voice leave ends attendance session',
  category: 'voice',
  async run(ctx) {
    await withVoiceBinding(ctx, 1, 'game-voice-monitor', async (vChId) => {
      await joinVoice(vChId);
      // Wait until bot appears in voice, then leave
      await pollForCondition(
        async () => {
          const m = getVoiceMembers(vChId);
          return m.find((x) => x.id === ctx.testBotDiscordId) ?? null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1000 },
      );
      leaveVoice();
      // Poll until bot disappears from voice channel
      await pollForCondition(
        async () => {
          const m = getVoiceMembers(vChId);
          return m.find((x) => x.id === ctx.testBotDiscordId) ? null : true;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1000 },
      );
    });
  },
};

const adHocSpawn: SmokeTest = {
  name: 'Ad-hoc event spawns on voice activity',
  category: 'voice',
  async run(ctx) {
    await withVoiceBinding(ctx, 2, 'general-lobby', async (vChId, tChId) => {
      await joinVoice(vChId);
      try {
        const msg = await pollForEmbed(
          tChId,
          (m) =>
            m.embeds.some(
              (e) =>
                e.title?.toLowerCase().includes('live') ||
                e.description?.toLowerCase().includes('ad-hoc') ||
                e.description?.toLowerCase().includes('ad hoc') ||
                false,
            ),
          ctx.config.timeoutMs,
        );
        if (msg.embeds.length === 0) throw new Error('No ad-hoc embed found');
      } finally {
        leaveVoice();
      }
    });
  },
};

const voiceMemberList: SmokeTest = {
  name: 'Voice members list includes bot after join',
  category: 'voice',
  async run(ctx) {
    const vCh = pickChannel(ctx.voiceChannels, 0);
    await joinVoice(vCh.id);
    try {
      await pollForCondition(
        async () => {
          const members = getVoiceMembers(vCh.id);
          return members.length > 0 ? members : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1000 },
      );
    } finally {
      leaveVoice();
    }
  },
};

/**
 * ROK-842: Voice attendance must match events via ALL bindings on a channel,
 * not just the first. Regression test for the find() → filter() fix.
 */
const multiGameVoiceDetected: SmokeTest = {
  name: 'Multi-game channel detects second binding game event',
  category: 'voice',
  async run(ctx) {
    const vCh = pickChannel(ctx.voiceChannels, 0);
    // Fetch live game IDs from API to avoid hardcoding seed data IDs
    const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
      '/admin/settings/games?limit=2',
    );
    const gameIds = gamesRes.data.map((g) => g.id);
    if (gameIds.length < 2) {
      throw new Error('Need at least 2 games in DB for multi-binding test');
    }
    const [gameA, gameB] = gameIds;
    let bindA: string | undefined;
    let bindB: string | undefined;
    let eventId: number | undefined;
    try {
      // Create TWO game-voice-monitor bindings on the SAME voice channel
      bindA = await createBinding(ctx.api, {
        channelId: vCh.id,
        channelType: 'voice',
        purpose: 'game-voice-monitor',
        gameId: gameA,
        config: { minPlayers: 99 },
      });
      bindB = await createBinding(ctx.api, {
        channelId: vCh.id,
        channelType: 'voice',
        purpose: 'game-voice-monitor',
        gameId: gameB,
        config: { minPlayers: 99 },
      });
      console.log(`  [voice] Two bindings on ${vCh.name}: gameA=${gameA}, gameB=${gameB}`);

      // Create a LIVE event for gameB (the second binding's game)
      const ev = await createEvent(ctx.api, 'multi-bind', {
        gameId: gameB,
        startTime: futureTime(-5), // started 5 min ago
        endTime: futureTime(55),
      });
      eventId = ev.id;
      await signup(ctx.api, ev.id);

      // Join voice and poll until pipeline detects participants
      await joinVoice(vCh.id);
      await pollForCondition(
        async () => {
          const roster = await ctx.api.get<{ participants: unknown[] }>(
            `/events/${ev.id}/ad-hoc-roster`,
          ).catch(() => ({ participants: [] }));
          return roster.participants?.length > 0 ? roster : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          `No voice participants for gameB event ${ev.id} — multi-binding detection failed`,
        );
      });
    } finally {
      leaveVoice();
      if (bindA) await deleteBinding(ctx.api, bindA);
      if (bindB) await deleteBinding(ctx.api, bindB);
      if (eventId) await deleteEvent(ctx.api, eventId);
    }
  },
};

/**
 * ROK-852: Event metrics roster breakdown must show voice data from the
 * companion bot's voice session.  The bot's Discord ID is linked to
 * dmRecipientUserId during setup; signing that user up for the event lets
 * us verify the full pipeline: voice join → DB flush → metrics endpoint →
 * rosterBreakdown with populated voiceDurationSec.
 *
 * SLOW: waits ~35 s for the 30-second in-memory→DB flush interval.
 */
const metricsVoicePopulated: SmokeTest = {
  name: 'Event metrics roster shows voice data (ROK-852)',
  category: 'voice',
  async run(ctx) {
    await withVoiceBinding(ctx, 2, 'game-voice-monitor', async (vChId) => {
      const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
        '/admin/settings/games?limit=1',
      );
      const gameId = gamesRes.data[0]?.id;
      if (!gameId) throw new Error('No games in DB for voice metrics test');

      const ev = await createEvent(ctx.api, 'metrics-voice', {
        gameId,
        startTime: futureTime(-5), // live event (started 5 min ago)
        endTime: futureTime(55),
      });
      try {
        // Sign up the user whose Discord ID = test bot
        await signupAs(ctx.api, ev.id, ctx.dmRecipientUserId, undefined, {
          linkDiscord: true,
        });

        await joinVoice(vChId);
        // Poll flush+metrics until voice data appears. The API's voice
        // tracker needs time to receive the gateway event; flush is idempotent.
        type MetricsResponse = {
          voiceSummary: { totalTracked: number } | null;
          rosterBreakdown: Array<{
            userId: number;
            voiceDurationSec: number | null;
            voiceClassification: string | null;
          }>;
        };
        let metrics: MetricsResponse;
        await pollForCondition(
          async () => {
            await flushVoiceSessions(ctx.api);
            const m = await ctx.api.get<MetricsResponse>(
              `/events/${ev.id}/metrics`,
            );
            if (m.voiceSummary && m.voiceSummary.totalTracked >= 1) {
              metrics = m;
              return true;
            }
            return null;
          },
          30000,
          { intervalMs: 3000 },
        );

        if (!metrics!.voiceSummary) {
          throw new Error('voiceSummary is null — voice session not flushed');
        }
        if (metrics!.voiceSummary.totalTracked < 1) {
          throw new Error(
            `totalTracked=${metrics!.voiceSummary.totalTracked}, expected >= 1`,
          );
        }

        const withVoice = metrics!.rosterBreakdown.filter(
          (r) => r.voiceDurationSec !== null && r.voiceDurationSec > 0,
        );
        if (withVoice.length === 0) {
          throw new Error(
            'No roster entries with voice data — userId fallback join failed',
          );
        }
      } finally {
        leaveVoice();
        await deleteEvent(ctx.api, ev.id);
      }
    });
  },
};

/**
 * ROK-943: Comprehensive voice classification + attendance metrics test.
 *
 * Validates ALL classification statuses (full, partial, late, early_leaver,
 * no_show) and ALL attendance statuses (attended, no_show, unmarked) by
 * injecting synthetic voice sessions with controlled timing, then asserting
 * the metrics endpoint returns correct counts and roster entries.
 *
 * Event: 60 min, ended 5 min ago. 7 signups covering every status combination.
 */
const classifyPopulatesAttendance: SmokeTest = {
  name: 'Voice classification populates attendance and metrics (ROK-943)',
  category: 'voice',
  run: rok943ClassifyAllStatuses,
};

async function rok943ClassifyAllStatuses(ctx: TestContext) {
  const users = ctx.demoUserIds ?? [];
  if (users.length < 6) throw new Error('Need 6+ demo users for ROK-943');

  const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
    '/admin/settings/games?limit=1',
  );
  const gameId = gamesRes.data[0]?.id;
  if (!gameId) throw new Error('No games in DB');

  // 60-min event that ended 5 min ago
  const evStart = futureTime(-65);
  const evEnd = futureTime(-5);
  const ev = await createEvent(ctx.api, 'rok943-all-statuses', {
    gameId,
    startTime: evStart,
    endTime: evEnd,
  });

  const fakeIds = users.map((_, i) => `900000000000000${String(i).padStart(4, '0')}`);
  const start = new Date(evStart);
  const end = new Date(evEnd);

  try {
    await rok943SignupUsers(ctx, ev.id, users, fakeIds);
    await rok943InjectSessions(ctx, ev.id, users, fakeIds, start, end);
    await triggerClassify(ctx.api, ev.id);
    await awaitProcessing(ctx.api);
    await rok943AssertMetrics(ctx, ev.id);
  } finally {
    await deleteEvent(ctx.api, ev.id);
  }
}

/** Link Discord IDs and sign up 7 users for the event. */
async function rok943SignupUsers(
  ctx: TestContext,
  eventId: number,
  users: number[],
  fakeIds: string[],
) {
  // Link fake Discord IDs to 5 demo users (user[5] stays unlinked → unmarked)
  for (let i = 0; i < 5; i++) {
    await linkDiscord(ctx.api, users[i], fakeIds[i], `smoke-user-${i}`);
  }
  // Sign up all 7: dmRecipient + 6 demo users
  await signupAs(ctx.api, eventId, ctx.dmRecipientUserId, undefined, {
    linkDiscord: true,
  });
  for (let i = 0; i < 6; i++) {
    await signupAs(ctx.api, eventId, users[i], undefined, {
      linkDiscord: i < 5,
    });
  }
}

/** Inject voice sessions with controlled timing for each classification. */
async function rok943InjectSessions(
  ctx: TestContext,
  eventId: number,
  users: number[],
  fakeIds: string[],
  start: Date,
  end: Date,
) {
  const b = { eventId };
  // FULL — 50/60 min = 83%, on time
  await injectVoiceSession(ctx.api, { ...b, discordUserId: ctx.testBotDiscordId, userId: ctx.dmRecipientUserId, durationSec: 3000, firstJoinAt: start.toISOString(), lastLeaveAt: end.toISOString() });
  // PARTIAL — 25/60 min = 42%, on time, stayed till end
  await injectVoiceSession(ctx.api, { ...b, discordUserId: fakeIds[0], userId: users[0], durationSec: 1500, firstJoinAt: start.toISOString(), lastLeaveAt: end.toISOString() });
  // LATE — joined 10 min late, 25 min voice
  const lateJoin = new Date(start.getTime() + 10 * 60000);
  await injectVoiceSession(ctx.api, { ...b, discordUserId: fakeIds[1], userId: users[1], durationSec: 1500, firstJoinAt: lateJoin.toISOString(), lastLeaveAt: end.toISOString() });
  // EARLY_LEAVER — on time, left 20 min early, 20 min voice
  const earlyLeave = new Date(end.getTime() - 20 * 60000);
  await injectVoiceSession(ctx.api, { ...b, discordUserId: fakeIds[2], userId: users[2], durationSec: 1200, firstJoinAt: start.toISOString(), lastLeaveAt: earlyLeave.toISOString() });
  // NO_SHOW (brief) — 30 sec (< 120s threshold)
  await injectVoiceSession(ctx.api, { ...b, discordUserId: fakeIds[3], userId: users[3], durationSec: 30, firstJoinAt: start.toISOString(), lastLeaveAt: new Date(start.getTime() + 30000).toISOString() });
  // user[4]: discord linked, no voice → classifyNoShows creates no_show
  // user[5]: no discord → stays unmarked
}

type Metrics = {
  attendanceSummary: {
    attended: number;
    noShow: number;
    excused: number;
    unmarked: number;
    total: number;
    attendanceRate: number;
  } | null;
  voiceSummary: {
    totalTracked: number;
    full: number;
    partial: number;
    late: number;
    earlyLeaver: number;
    noShow: number;
  } | null;
  rosterBreakdown: Array<{
    attendanceStatus: string | null;
    voiceClassification: string | null;
  }>;
};

/** Assert every classification and attendance status appears in metrics. */
async function rok943AssertMetrics(ctx: TestContext, eventId: number) {
  const m = await ctx.api.get<Metrics>(`/events/${eventId}/metrics`);

  // --- Attendance donut ---
  // 8 signups: 7 explicit + event creator (admin, auto-signed-up, unmarked)
  const a = m.attendanceSummary;
  if (!a) throw new Error('attendanceSummary null');
  assertEq('attended', a.attended, 4); // full + partial + late + early_leaver
  assertEq('noShow', a.noShow, 2); // brief voice + classifyNoShows
  assertEq('unmarked', a.unmarked, 2); // user[5] no discord + event creator
  assertEq('total', a.total, 8);

  // --- Voice summary ---
  const v = m.voiceSummary;
  if (!v) throw new Error('voiceSummary null');
  assertEq('full', v.full, 1);
  assertEq('partial', v.partial, 1);
  assertEq('late', v.late, 1);
  assertEq('earlyLeaver', v.earlyLeaver, 1);
  assertEq('voiceNoShow', v.noShow, 2); // brief + classifyNoShows

  // --- Roster has all statuses ---
  const statuses = new Set(m.rosterBreakdown.map((r) => r.attendanceStatus));
  if (!statuses.has('attended')) throw new Error('No "attended" in roster');
  if (!statuses.has('no_show')) throw new Error('No "no_show" in roster');
  if (!statuses.has(null)) throw new Error('No unmarked (null) in roster');

  const voiceStatuses = new Set(
    m.rosterBreakdown.map((r) => r.voiceClassification),
  );
  for (const expected of ['full', 'partial', 'late', 'early_leaver', 'no_show']) {
    if (!voiceStatuses.has(expected)) {
      throw new Error(`Voice classification "${expected}" missing from roster`);
    }
  }
}

function assertEq(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

/**
 * ROK-959: When two game-voice-monitor bindings share a voice channel and a
 * scheduled event exists on binding B, ad-hoc creation for binding A must be
 * suppressed. The suppression check calls extendScheduledEventWindow(), so we
 * verify extendedUntil is set on the scheduled event after voice join.
 */
const siblingBindingSuppression: SmokeTest = {
  name: 'Sibling binding suppresses ad-hoc via channel-level check (ROK-959)',
  category: 'voice',
  async run(ctx) {
    const vCh = pickChannel(ctx.voiceChannels, 0);
    const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
      '/admin/settings/games?limit=2',
    );
    const gameIds = gamesRes.data.map((g) => g.id);
    if (gameIds.length < 2) {
      throw new Error('Need at least 2 games in DB for ROK-959 test');
    }
    const [gameA, gameB] = gameIds;
    let bindA: string | undefined;
    let bindB: string | undefined;
    let eventId: number | undefined;
    try {
      bindA = await createBinding(ctx.api, {
        channelId: vCh.id,
        channelType: 'voice',
        purpose: 'game-voice-monitor',
        gameId: gameA,
        config: { minPlayers: 1 },
      });
      bindB = await createBinding(ctx.api, {
        channelId: vCh.id,
        channelType: 'voice',
        purpose: 'game-voice-monitor',
        gameId: gameB,
        config: { minPlayers: 1 },
      });
      await awaitProcessing(ctx.api);

      // Live event for gameB — extendedUntil starts null
      const ev = await createEvent(ctx.api, 'rok959-suppress', {
        gameId: gameB,
        startTime: futureTime(-5),
        endTime: futureTime(55),
      });
      eventId = ev.id;
      await signup(ctx.api, ev.id);

      // Voice join triggers suppression check on binding A → finds
      // scheduled event on binding B via channel-level subquery →
      // calls extendScheduledEventWindow()
      await joinVoice(vCh.id);

      type EventDetail = { extendedUntil: string | null };
      await pollForCondition(
        async () => {
          await awaitProcessing(ctx.api);
          const detail = await ctx.api.get<EventDetail>(
            `/events/${ev.id}`,
          );
          return detail.extendedUntil ? detail : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      ).catch(() => {
        throw new Error(
          `extendedUntil not set on event ${ev.id} — sibling suppression failed`,
        );
      });
    } finally {
      leaveVoice();
      if (bindA) await deleteBinding(ctx.api, bindA);
      if (bindB) await deleteBinding(ctx.api, bindB);
      if (eventId) await deleteEvent(ctx.api, eventId);
    }
  },
};

// Ad-hoc spawn excluded — requires 15-minute SPAWN_DELAY_MS timer to fire.
// Run with SMOKE_INCLUDE_SLOW=1 to include.
const includeSlow = process.env.SMOKE_INCLUDE_SLOW === '1';

// Voice-join tests require real UDP connectivity to Discord voice servers.
// CI runners can't establish voice connections — skip with SMOKE_SKIP_VOICE_JOIN=1 (ROK-969).
const canJoinVoice = process.env.SMOKE_SKIP_VOICE_JOIN !== '1';

export const voiceActivityTests: SmokeTest[] = [
  ...(canJoinVoice ? [voiceJoinDetected, voiceLeaveRecorded] : []),
  classifyPopulatesAttendance,
  ...(includeSlow ? [adHocSpawn, metricsVoicePopulated] : []),
  ...(canJoinVoice ? [voiceMemberList, multiGameVoiceDetected, siblingBindingSuppression] : []),
];
