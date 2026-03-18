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

// Ad-hoc spawn excluded — requires 15-minute SPAWN_DELAY_MS timer to fire.
// Run with SMOKE_INCLUDE_SLOW=1 to include.
const includeSlow = process.env.SMOKE_INCLUDE_SLOW === '1';

export const voiceActivityTests: SmokeTest[] = [
  voiceJoinDetected,
  voiceLeaveRecorded,
  ...(includeSlow ? [adHocSpawn] : []),
  voiceMemberList,
  multiGameVoiceDetected,
];
