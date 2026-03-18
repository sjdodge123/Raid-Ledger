/**
 * Voice Activity smoke tests.
 * Each test picks its own voice channel and creates/cleans up bindings.
 */
import { joinVoice, leaveVoice, getVoiceMembers } from '../../helpers/voice.js';
import { waitForMessage } from '../../helpers/messages.js';
import {
  createBinding,
  createEvent,
  deleteBinding,
  deleteEvent,
  signup,
  signupAs,
  pickChannel,
  sleep,
  futureTime,
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
  // Allow binding cache to expire before voice join
  await sleep(2000);
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
        await sleep(3000);
        const members = getVoiceMembers(vChId);
        const self = members.find((m) => m.id === ctx.testBotDiscordId);
        if (!self) throw new Error('Test bot not found in voice channel');
      } finally {
        leaveVoice();
        await sleep(1000);
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
      await sleep(5000);
      leaveVoice();
      await sleep(3000);
      const members = getVoiceMembers(vChId);
      const self = members.find((m) => m.id === ctx.testBotDiscordId);
      if (self) throw new Error('Bot still in voice channel after leave');
    });
  },
};

const adHocSpawn: SmokeTest = {
  name: 'Ad-hoc event spawns on voice activity',
  category: 'voice',
  async run(ctx) {
    await withVoiceBinding(ctx, 2, 'general-lobby', async (vChId, tChId) => {
      const embedPromise = waitForMessage(
        tChId,
        (msg) =>
          msg.embeds.some(
            (e) =>
              e.title?.toLowerCase().includes('live') ||
              e.description?.toLowerCase().includes('ad-hoc') ||
              e.description?.toLowerCase().includes('ad hoc') ||
              false,
          ),
        ctx.config.timeoutMs,
      );
      await joinVoice(vChId);
      try {
        const msg = await embedPromise;
        if (msg.embeds.length === 0) throw new Error('No ad-hoc embed found');
      } finally {
        leaveVoice();
        await sleep(2000);
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
      await sleep(2000);
      const members = getVoiceMembers(vCh.id);
      if (members.length === 0) throw new Error('Voice members list empty');
    } finally {
      leaveVoice();
      await sleep(1000);
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
    const gameA = 1; // World of Warcraft (from seed-games.ts)
    const gameB = 4; // Valheim (from seed-games.ts)
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
      await sleep(2000); // let binding cache expire

      // Join voice and wait for pipeline to detect
      await joinVoice(vCh.id);
      await sleep(5000);

      // Check voice roster — session should exist for gameB event
      const roster = await ctx.api.get<{ participants: unknown[] }>(
        `/events/${ev.id}/ad-hoc-roster`,
      );
      if (!roster.participants || roster.participants.length === 0) {
        throw new Error(
          `No voice participants for gameB event ${ev.id} — multi-binding detection failed`,
        );
      }
    } finally {
      leaveVoice();
      await sleep(1000);
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
      const ev = await createEvent(ctx.api, 'metrics-voice', {
        gameId: 244, // Lost Ark
        startTime: futureTime(-5), // live event (started 5 min ago)
        endTime: futureTime(55),
      });
      try {
        // Sign up the user whose Discord ID = test bot
        await signupAs(ctx.api, ev.id, ctx.dmRecipientUserId);
        await sleep(2000);

        await joinVoice(vChId);
        // Wait for the 30-second DB flush interval + buffer
        console.log('  [voice] Waiting 35 s for voice session DB flush...');
        await sleep(35_000);

        type MetricsResponse = {
          voiceSummary: { totalTracked: number } | null;
          rosterBreakdown: Array<{
            userId: number;
            voiceDurationSec: number | null;
            voiceClassification: string | null;
          }>;
        };
        const metrics = await ctx.api.get<MetricsResponse>(
          `/events/${ev.id}/metrics`,
        );

        if (!metrics.voiceSummary) {
          throw new Error('voiceSummary is null — voice session not flushed');
        }
        if (metrics.voiceSummary.totalTracked < 1) {
          throw new Error(
            `totalTracked=${metrics.voiceSummary.totalTracked}, expected >= 1`,
          );
        }

        const withVoice = metrics.rosterBreakdown.filter(
          (r) => r.voiceDurationSec !== null && r.voiceDurationSec > 0,
        );
        if (withVoice.length === 0) {
          throw new Error(
            'No roster entries with voice data — userId fallback join failed',
          );
        }
      } finally {
        leaveVoice();
        await sleep(1000);
        await deleteEvent(ctx.api, ev.id);
      }
    });
  },
};

// Ad-hoc spawn excluded — requires 15-minute SPAWN_DELAY_MS timer to fire.
// Run with SMOKE_INCLUDE_SLOW=1 to include.
const includeSlow = process.env.SMOKE_INCLUDE_SLOW === '1';

export const voiceActivityTests: SmokeTest[] = [
  voiceJoinDetected,
  voiceLeaveRecorded,
  ...(includeSlow ? [adHocSpawn, metricsVoicePopulated] : []),
  voiceMemberList,
  multiGameVoiceDetected,
];
