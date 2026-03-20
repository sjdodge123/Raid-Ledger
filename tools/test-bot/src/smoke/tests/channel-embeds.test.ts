/**
 * Channel Embed smoke tests.
 * All embeds post to the default notification channel.
 * Each test creates its own event with a unique title for isolation.
 * When an MMO game + character are available, events use slot configs
 * and signups include character/role assignment.
 */
import { pollForEmbed, waitForEmbedUpdate } from '../../helpers/polling.js';
import {
  createEvent,
  signup,
  cancelSignup,
  cancelEvent,
  rescheduleEvent,
  deleteEvent,
  awaitProcessing,
} from '../fixtures.js';
import { assertEmbedTitle, assertEmbedCount, assertHasButton } from '../assert.js';
import type { SmokeTest, TestContext } from '../types.js';

/** Build event overrides for MMO roster testing when game + char available. */
function mmoOverrides(ctx: TestContext) {
  if (!ctx.mmoGameId) return {};
  return {
    gameId: ctx.mmoGameId,
    slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0, bench: 1 },
  };
}

/** Build signup overrides with character + preferred roles. */
function mmoSignupOpts(ctx: TestContext, roles?: string[]) {
  if (!ctx.testCharId) return {};
  const preferred = roles ?? [ctx.testCharRole ?? 'dps'];
  return { characterId: ctx.testCharId, preferredRoles: preferred };
}

function embedInChannel(chId: string, title: string, timeoutMs: number) {
  return pollForEmbed(
    chId,
    (msg) => msg.embeds.some((e) => e.title?.includes(title)),
    timeoutMs,
  );
}

const eventEmbedPosted: SmokeTest = {
  name: 'Event embed posted to channel',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'embed-post', mmoOverrides(ctx));
    try {
      const msg = await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      assertEmbedCount(msg.embeds, 1);
      assertEmbedTitle(msg.embeds[0], new RegExp(ev.title));
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const embedFilling: SmokeTest = {
  name: 'Embed updates to FILLING on signup',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'embed-filling', mmoOverrides(ctx));
    try {
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      await signup(ctx.api, ev.id, mmoSignupOpts(ctx, ['dps']));
      await waitForEmbedUpdate(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some(
            (e) =>
              e.title?.includes(ev.title) &&
              e.description?.includes('ROSTER:'),
          ),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const embedTentative: SmokeTest = {
  name: 'Tentative signup reflected in embed',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'embed-tentative', mmoOverrides(ctx));
    try {
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      await signup(ctx.api, ev.id, mmoSignupOpts(ctx, ['healer']));
      await waitForEmbedUpdate(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some(
            (e) =>
              e.title?.includes(ev.title) &&
              e.description?.includes('ROSTER:'),
          ),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const embedCancelSignup: SmokeTest = {
  name: 'Embed updates when signup cancelled',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'embed-unsignup', mmoOverrides(ctx));
    try {
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      await signup(ctx.api, ev.id, mmoSignupOpts(ctx, ['tank']));
      // Wait for embed to show the signup in the roster
      await waitForEmbedUpdate(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some(
            (e) =>
              e.title?.includes(ev.title) &&
              e.description?.includes('ROSTER:'),
          ),
        ctx.config.timeoutMs,
      );
      await cancelSignup(ctx.api, ev.id);
      // After cancel, roster count drops to 0: MMO shows "ROSTER: 0/",
      // non-MMO removes the roster section entirely
      await waitForEmbedUpdate(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some(
            (e) =>
              e.title?.includes(ev.title) &&
              (!e.description?.includes('ROSTER:') ||
                e.description.includes('ROSTER: 0/')),
          ),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const embedCancelled: SmokeTest = {
  name: 'Event cancellation updates embed',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'embed-cancel', mmoOverrides(ctx));
    try {
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      await cancelEvent(ctx.api, ev.id);
      await waitForEmbedUpdate(
        ctx.defaultChannelId,
        (m) => m.embeds.some((e) => e.title?.includes('CANCELLED')),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const embedReschedule: SmokeTest = {
  name: 'Reschedule updates embed time',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'embed-resched', mmoOverrides(ctx));
    try {
      const original = await embedInChannel(
        ctx.defaultChannelId,
        ev.title,
        ctx.config.timeoutMs,
      );
      // Capture the original timestamp from the embed description
      const originalDesc = original.embeds[0]?.description ?? '';
      const originalTs = originalDesc.match(/<t:(\d+):f>/)?.[1] ?? '';
      await rescheduleEvent(ctx.api, ev.id, 180);
      // Wait for the embed timestamp to change from the original
      await waitForEmbedUpdate(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some(
            (e) =>
              e.title?.includes(ev.title) &&
              !!e.description?.includes('<t:') &&
              !e.description.includes(`<t:${originalTs}:f>`),
          ),
        ctx.config.timeoutMs,
      );
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const embedHasButtons: SmokeTest = {
  name: 'Event embed has signup buttons',
  category: 'embed',
  async run(ctx) {
    const ev = await createEvent(ctx.api, 'embed-btns', mmoOverrides(ctx));
    try {
      const msg = await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      assertHasButton(msg.components, 'Sign Up');
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const nonMmoNoWowAvatars: SmokeTest = {
  name: 'Non-MMO event roster does not show WoW character avatars (ROK-918)',
  category: 'embed',
  async run(ctx) {
    // Find a non-MMO game (hasRoles=false) so the gameId-based filter runs.
    // Using gameId: null would skip the filter entirely (original behavior).
    type GameRow = { id: number; name: string; hasRoles: boolean };
    const configuredGames = await ctx.api
      .get<{ data: GameRow[] }>('/games/configured')
      .then((r) => (Array.isArray(r.data) ? r.data : (r as unknown as GameRow[])))
      .catch(() => [] as GameRow[]);
    const nonMmoGame = configuredGames.find(
      (g) => !g.hasRoles && g.id !== ctx.mmoGameId,
    );
    if (!nonMmoGame) {
      console.log('    SKIP: No non-MMO game found in configured games');
      return;
    }
    // Create event with the non-MMO gameId so the game filter is exercised
    const ev = await createEvent(ctx.api, 'embed-nowow', {
      gameId: nonMmoGame.id,
      maxAttendees: 10,
    });
    try {
      await embedInChannel(ctx.defaultChannelId, ev.title, ctx.config.timeoutMs);
      // Sign up with MMO character (which has a WoW class)
      await signup(ctx.api, ev.id, mmoSignupOpts(ctx));
      await awaitProcessing(ctx.api);
      // Re-poll for the embed (don't depend on catching the edit event)
      const found = await pollForEmbed(
        ctx.defaultChannelId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      const desc = found.embeds[0]?.description ?? '';
      // WoW class emojis use custom emoji format: <:ClassName:id>
      // A non-MMO-game event should NOT show WoW class emojis
      const wowClassPattern = /<:(?:Warrior|Mage|Rogue|Priest|Paladin|Druid|Shaman|Hunter|Warlock|Monk|DemonHunter|DeathKnight|Evoker):/i;
      if (wowClassPattern.test(desc)) {
        throw new Error(
          `Non-MMO game event embed contains WoW class emoji: "${desc.slice(0, 200)}"`,
        );
      }
    } finally {
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const channelEmbedTests: SmokeTest[] = [
  eventEmbedPosted,
  embedFilling,
  embedTentative,
  embedCancelSignup,
  embedCancelled,
  embedReschedule,
  embedHasButtons,
  nonMmoNoWowAvatars,
];
