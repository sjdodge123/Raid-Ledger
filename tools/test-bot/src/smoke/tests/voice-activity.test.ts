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
 * ROK-943: Voice classification must populate attendance and produce
 * non-zero attended count when a user has significant voice time.
 *
 * Injects a synthetic 30-minute voice session (bypassing real-time voice
 * tracking), then triggers classification and asserts attended >= 1.
 * This validates the full pipeline: session → classify → attendance → metrics.
 */
const classifyPopulatesAttendance: SmokeTest = {
  name: 'Voice classification populates attendance and metrics (ROK-943)',
  category: 'voice',
  async run(ctx) {
    const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
      '/admin/settings/games?limit=1',
    );
    const gameId = gamesRes.data[0]?.id;
    if (!gameId) throw new Error('No games in DB');

    const ev = await createEvent(ctx.api, 'rok943-classify', {
      gameId,
      startTime: futureTime(-65),
      endTime: futureTime(-5),
    });
    try {
      await signupAs(ctx.api, ev.id, ctx.dmRecipientUserId, undefined, {
        linkDiscord: true,
      });

      // Inject a synthetic 30-min voice session (>= 120s threshold for
      // classification as something other than no_show).
      await injectVoiceSession(ctx.api, {
        eventId: ev.id,
        discordUserId: ctx.testBotDiscordId,
        userId: ctx.dmRecipientUserId,
        durationSec: 1800,
      });

      await triggerClassify(ctx.api, ev.id);
      await awaitProcessing(ctx.api);

      type MetricsResponse = {
        attendanceSummary: {
          attended: number;
          attendanceRate: number;
        } | null;
        voiceSummary: { totalTracked: number } | null;
      };
      const metrics = await ctx.api.get<MetricsResponse>(
        `/events/${ev.id}/metrics`,
      );

      if (!metrics.voiceSummary) {
        throw new Error('voiceSummary null after classify');
      }
      if (metrics.voiceSummary.totalTracked < 1) {
        throw new Error(
          `totalTracked=${metrics.voiceSummary.totalTracked}, expected >= 1`,
        );
      }
      if (!metrics.attendanceSummary) {
        throw new Error('attendanceSummary null after classify');
      }
      if (metrics.attendanceSummary.attended < 1) {
        throw new Error(
          `attended=${metrics.attendanceSummary.attended}, expected >= 1`,
        );
      }
      if (metrics.attendanceSummary.attendanceRate <= 0) {
        throw new Error(
          `attendanceRate=${metrics.attendanceSummary.attendanceRate}, expected > 0`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

// Ad-hoc spawn excluded — requires 15-minute SPAWN_DELAY_MS timer to fire.
// Run with SMOKE_INCLUDE_SLOW=1 to include.
const includeSlow = process.env.SMOKE_INCLUDE_SLOW === '1';

export const voiceActivityTests: SmokeTest[] = [
  voiceJoinDetected,
  voiceLeaveRecorded,
  classifyPopulatesAttendance,
  ...(includeSlow ? [adHocSpawn, metricsVoicePopulated] : []),
  voiceMemberList,
  multiGameVoiceDetected,
];
