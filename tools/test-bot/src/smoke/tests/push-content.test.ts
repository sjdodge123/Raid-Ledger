/**
 * Push Content smoke tests (ROK-864).
 * Validates that channel embed messages include a plaintext `content` field
 * suitable for Discord mobile push notification previews.
 * Content must be free of raw Discord tokens and markdown.
 */
import { waitForMessage } from '../../helpers/messages.js';
import { pollForEmbed, waitForEmbedUpdate } from '../../helpers/polling.js';
import {
  createEvent,
  signup,
  cancelEvent,
  deleteEvent,
} from '../fixtures.js';
import {
  assertEmbedCount,
  assertHasContent,
  assertNoDiscordTokens,
  assertNoMarkdown,
} from '../assert.js';
import type { SmokeTest, TestContext } from '../types.js';

function embedInChannel(chId: string, title: string, timeoutMs: number) {
  return waitForMessage(
    chId,
    (msg) => msg.embeds.some((e) => e.title?.includes(title)),
    timeoutMs,
  );
}

/** Build event overrides for MMO roster testing when game + char available. */
function mmoOverrides(ctx: TestContext) {
  if (!ctx.mmoGameId) return {};
  return {
    gameId: ctx.mmoGameId,
    slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 1 },
  };
}

function mmoSignupOpts(ctx: TestContext) {
  if (!ctx.testCharId) return {};
  return {
    characterId: ctx.testCharId,
    preferredRoles: [ctx.testCharRole ?? 'dps'],
  };
}

// ─── Tests ───────────────────────────────────────────────────

const eventEmbedHasContent: SmokeTest = {
  name: 'Event embed includes push content field (ROK-864)',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'push-content', mmoOverrides(ctx));
    try {
      const msg = await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      assertEmbedCount(msg.embeds, 1);
      assertHasContent(msg.content);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const contentHasNoDiscordTokens: SmokeTest = {
  name: 'Push content has no raw Discord tokens (ROK-864)',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'push-tokens', mmoOverrides(ctx));
    try {
      const msg = await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      assertNoDiscordTokens(msg.content);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const contentHasNoMarkdown: SmokeTest = {
  name: 'Push content has no raw markdown (ROK-864)',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'push-md', mmoOverrides(ctx));
    try {
      const msg = await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      assertNoMarkdown(msg.content);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const contentIncludesTitle: SmokeTest = {
  name: 'Push content includes event title (ROK-864)',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'push-title', mmoOverrides(ctx));
    try {
      const msg = await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      assertHasContent(msg.content);
      // Title may be truncated, check first 20 chars of the unique tag
      const titleStart = ev.title.slice(0, 20);
      if (!msg.content.includes(titleStart)) {
        throw new Error(
          `Expected content to include title "${titleStart}...", got: "${msg.content}"`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const contentIncludesSignupCount: SmokeTest = {
  name: 'Push content includes signup count (ROK-864)',
  category: 'embed',
  async run(ctx) {
    // Create without game so title is short enough to fit "signed up" within 80 chars
    const ev = await createEvent(ctx.api, 'push-count', {});
    try {
      const msg = await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      assertHasContent(msg.content);
      // Content may be truncated if title is long — check either "signed up" or "..."
      if (!msg.content.includes('signed up') && !msg.content.endsWith('...')) {
        throw new Error(
          `Expected content to include "signed up" or be truncated, got: "${msg.content}"`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const cancelledEmbedHasContent: SmokeTest = {
  name: 'Cancelled event embed has push content (ROK-864)',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'push-cancel', mmoOverrides(ctx));
    try {
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      await cancelEvent(ctx.api, ev.id);
      // Poll for the edit — cancel edits are slow under parallel load (60s)
      const found = await waitForEmbedUpdate(
        ctx.defaultChannelId,
        (m) => m.embeds.some((e) => e.title?.includes('CANCELLED')),
        60_000,
      );
      assertHasContent(found.content);
      assertNoDiscordTokens(found.content);
      assertNoMarkdown(found.content);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const updatedEmbedKeepsContent: SmokeTest = {
  name: 'Updated embed preserves push content after signup (ROK-864)',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'push-update', mmoOverrides(ctx));
    try {
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      await signup(ctx.api, ev.id, mmoSignupOpts(ctx));
      const found = await waitForEmbedUpdate(
        ctx.defaultChannelId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      assertHasContent(found.content);
      assertNoDiscordTokens(found.content);
      assertNoMarkdown(found.content);
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const pushContentTests: SmokeTest[] = [
  eventEmbedHasContent,
  contentHasNoDiscordTokens,
  contentHasNoMarkdown,
  contentIncludesTitle,
  contentIncludesSignupCount,
  cancelledEmbedHasContent,
  updatedEmbedKeepsContent,
];
