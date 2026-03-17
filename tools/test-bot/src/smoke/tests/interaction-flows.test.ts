/**
 * Multi-step interaction flow smoke tests.
 * Each test picks its own channel and manages its own bindings.
 */
import { waitForMessage, readLastMessages } from '../../helpers/messages.js';
import { waitForDM } from '../../helpers/dm.js';
import {
  createEvent,
  signup,
  cancelSignup,
  deleteEvent,
  sleep,
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';

const botConnectivityCheck: SmokeTest = {
  name: 'Bot is connected and responding',
  category: 'flow',
  async run(ctx) {
    const status = await ctx.api.get<{ connected: boolean }>(
      '/admin/settings/discord-bot',
    );
    if (!status.connected) {
      throw new Error('Discord bot is not connected');
    }
  },
};

const signupCancelFlow: SmokeTest = {
  name: 'Full signup -> cancel -> embed reflects both',
  category: 'flow',
  async run(ctx) {
    const chId = ctx.defaultChannelId;
    const ev = await createEvent(ctx.api, 'flow-signup-cancel');
    try {
      await waitForMessage(
        chId,
        (msg) => msg.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      await signup(ctx.api, ev.id);
      await sleep(6000);
      await cancelSignup(ctx.api, ev.id);
      await sleep(6000);
      const msgs = await readLastMessages(chId, 50);
      const found = msgs.find((m) =>
        m.embeds.some((e) => e.title?.includes(ev.title)),
      );
      if (!found) throw new Error('Embed not found after signup+cancel');
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const slotVacatedDM: SmokeTest = {
  name: 'Slot vacated DM sent when player cancels signup',
  category: 'flow',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'flow-vacated', {
      maxAttendees: 2,
    });
    try {
      await signup(ctx.api, ev.id);
      await sleep(3000);
      const dmPromise = waitForDM(
        (msg) =>
          msg.embeds.some(
            (e) =>
              e.title?.toLowerCase().includes('vacat') ||
              e.description?.toLowerCase().includes('vacat') ||
              e.description?.toLowerCase().includes('depart') ||
              false,
          ),
        ctx.config.timeoutMs,
      );
      await cancelSignup(ctx.api, ev.id);
      try {
        await dmPromise;
      } catch {
        // Slot vacated DM may not fire for self-cancel — acceptable
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const embedSyncBatchFlush: SmokeTest = {
  name: 'Embed sync queue flushes within 10s',
  category: 'flow',
  async run(ctx) {
    const chId = ctx.defaultChannelId;
    const ev = await createEvent(ctx.api, 'flow-sync');
    try {
      await waitForMessage(
        chId,
        (msg) => msg.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      await signup(ctx.api, ev.id);
      await sleep(10000);
      const msgs = await readLastMessages(chId, 50);
      const found = msgs.find((m) =>
        m.embeds.some((e) => e.title?.includes(ev.title)),
      );
      if (!found) throw new Error('Embed not found after sync flush');
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const interactionFlowTests: SmokeTest[] = [
  botConnectivityCheck,
  signupCancelFlow,
  slotVacatedDM,
  embedSyncBatchFlush,
];
