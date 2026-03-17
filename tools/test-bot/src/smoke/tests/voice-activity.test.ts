/**
 * Voice Activity smoke tests.
 * Each test picks its own voice channel and creates/cleans up bindings.
 */
import { joinVoice, leaveVoice, getVoiceMembers } from '../../helpers/voice.js';
import { waitForMessage } from '../../helpers/messages.js';
import {
  createBinding,
  deleteBinding,
  pickChannel,
  sleep,
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
  } catch { /* may already exist */ }
  try {
    tBindingId = await createBinding(ctx.api, {
      channelId: tCh.id,
      channelType: 'text',
      purpose: 'game-announcements',
    });
  } catch { /* may already exist */ }
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

export const voiceActivityTests: SmokeTest[] = [
  voiceJoinDetected,
  voiceLeaveRecorded,
  adHocSpawn,
  voiceMemberList,
];
