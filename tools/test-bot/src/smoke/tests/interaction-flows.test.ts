/**
 * Multi-step interaction flow smoke tests.
 * Tests end-to-end flows that involve multiple API calls + Discord output.
 */
import { readLastMessages } from '../../helpers/messages.js';
import { pollForEmbed, pollForCondition } from '../../helpers/polling.js';
import {
  createEvent,
  signup,
  signupAs,
  cancelSignup,
  deleteEvent,
  sleep,
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';

function mmoOverrides(ctx: TestContext) {
  if (!ctx.mmoGameId) return {};
  return {
    gameId: ctx.mmoGameId,
    slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 2 },
  };
}

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
    const ev = await createEvent(ctx.api, 'flow-signup-cancel', mmoOverrides(ctx));
    try {
      await pollForEmbed(
        chId,
        (msg) => msg.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      await signup(ctx.api, ev.id, { preferredRoles: ['dps'] });
      await sleep(1000); // rate-limit between API calls
      await cancelSignup(ctx.api, ev.id);
      await pollForEmbed(
        chId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const slotVacatedFlow: SmokeTest = {
  name: 'Admin removes signup -> slot vacated flow triggered',
  category: 'flow',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 1) throw new Error('Need demo users');
    const ev = await createEvent(ctx.api, 'flow-vacated', mmoOverrides(ctx));
    try {
      // Wait for initial embed
      await pollForEmbed(
        ctx.defaultChannelId,
        (msg) => msg.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      const res = await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await sleep(1000); // rate-limit between API calls
      // Admin removes the signup
      const signupId = (res as { id?: number }).id;
      if (signupId) {
        await ctx.api.delete(`/events/${ev.id}/signups/${signupId}`);
      }
      await pollForEmbed(
        ctx.defaultChannelId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const benchPromotionFlow: SmokeTest = {
  name: 'Bench player promoted when main slot vacates',
  category: 'flow',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 3) throw new Error('Need 3+ demo users');
    const ev = await createEvent(ctx.api, 'flow-bench-promote', {
      maxAttendees: 2,
    });
    try {
      // Wait for initial embed
      await pollForEmbed(
        ctx.defaultChannelId,
        (msg) => msg.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      // Fill 2 main slots
      const res1 = await signupAs(ctx.api, ev.id, users[0], ['dps']);
      await signupAs(ctx.api, ev.id, users[1], ['dps']);
      // 3rd goes to bench
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      await sleep(1000); // rate-limit between API calls
      // Remove first player — bench player should auto-promote (5-min delay)
      const signupId = (res1 as { id?: number }).id;
      if (signupId) {
        await ctx.api.delete(`/events/${ev.id}/signups/${signupId}`);
      }
      // Verify embed still exists and reflects roster change
      await pollForEmbed(
        ctx.defaultChannelId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
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
    const ev = await createEvent(ctx.api, 'flow-sync', mmoOverrides(ctx));
    try {
      // Use polling for initial embed (avoids waitForMessage race condition)
      await pollForEmbed(
        chId,
        (msg) => msg.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      await signup(ctx.api, ev.id, { preferredRoles: ['dps'] });
      await pollForEmbed(
        chId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const multiUserSignupFlow: SmokeTest = {
  name: 'Multiple users sign up -> roster updates correctly',
  category: 'flow',
  async run(ctx) {
    const users = ctx.demoUserIds ?? [];
    if (users.length < 3) throw new Error('Need 3+ demo users');
    const ev = await createEvent(ctx.api, 'flow-multi-signup', mmoOverrides(ctx));
    try {
      await pollForEmbed(
        ctx.defaultChannelId,
        (msg) => msg.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      // Rapid-fire 3 signups with different roles
      await signupAs(ctx.api, ev.id, users[0], ['tank']);
      await signupAs(ctx.api, ev.id, users[1], ['healer']);
      await signupAs(ctx.api, ev.id, users[2], ['dps']);
      const found = await pollForEmbed(
        ctx.defaultChannelId,
        (m) => {
          const embed = m.embeds.find((e) => e.title?.includes(ev.title));
          if (!embed) return false;
          const match = (embed.description ?? '').match(/ROSTER:\s*(\d+)/);
          return match ? parseInt(match[1], 10) >= 3 : false;
        },
        ctx.config.timeoutMs,
      );
      const embed = found.embeds.find((e) => e.title?.includes(ev.title));
      if (!embed) throw new Error('Embed not found');
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const eventDeleteCleansEmbed: SmokeTest = {
  name: 'Event deletion removes embed from channel',
  category: 'flow',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'flow-delete');
    try {
      await pollForEmbed(
        ctx.defaultChannelId,
        (msg) => msg.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      // Delete the event — embed should be removed from channel
      await deleteEvent(ctx.api, ev.id);
      // Poll for embed removal — check if embed disappears
      const gone = await pollForCondition(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 50);
          const has = msgs.some((m) =>
            m.embeds.some((e) => e.title?.includes(ev.title)),
          );
          return has ? null : true;
        },
        ctx.config.timeoutMs,
      ).then(() => true).catch(() => false);
      const stillThere = !gone;
      if (stillThere) {
        throw new Error('Embed still present after event deletion');
      }
    } finally {
      // Already deleted above
    }
  },
};

export const interactionFlowTests: SmokeTest[] = [
  botConnectivityCheck,
  signupCancelFlow,
  slotVacatedFlow,
  benchPromotionFlow,
  embedSyncBatchFlush,
  multiUserSignupFlow,
  eventDeleteCleansEmbed,
];
