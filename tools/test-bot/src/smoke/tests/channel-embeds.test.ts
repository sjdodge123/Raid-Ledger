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
  channelForTest,
  channelForGame,
} from '../fixtures.js';
import {
  assertEmbedTitle,
  assertEmbedCount,
  assertHasButton,
  assertEmbedColor,
  imminentAuthorPattern,
} from '../assert.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { SimpleEmbed } from '../../helpers/messages.js';
import type { ApiClient } from '../api.js';

/** EMBED_COLORS.REMINDER — the `needs_you` colour a soon-to-start event wears. */
const REMINDER_AMBER = 0xf59e0b;
/** EMBED_COLORS.ERROR — the `cancelled` colour. */
const CANCELLED_RED = 0xef4444;
/** Same fallback the API applies when no community name is configured. */
const DEFAULT_COMMUNITY = 'Raid Ledger';

/** The community name the chrome renders, read from the API's own branding. */
async function fetchCommunityName(api: ApiClient): Promise<string> {
  const branding = await api
    .get<{ communityName: string | null }>('/system/branding')
    .catch(() => null);
  const name = branding?.communityName?.trim();
  return name ? name : DEFAULT_COMMUNITY;
}

/**
 * ROK-1460 replaced the `ROSTER: n/max` description header with the chrome
 * author line, which carries the same count as `{n} of {max}`. Smoke events are
 * created 60 minutes out, so their lifecycle state is IMMINENT.
 */
function embedShowsSignupCount(
  e: SimpleEmbed,
  title: string,
  count: number,
): boolean {
  return (
    !!e.title?.includes(title) &&
    !!e.author?.includes(`${count} of `) &&
    !e.description?.includes('ROSTER:')
  );
}

/**
 * The event's real signup count and capacity, read from the API.
 *
 * ROK-1460 fix 11: the creator is auto-signed-up on create, so the chrome
 * author line reads `1 of 10`, not `0 of 10`. Read the truth rather than
 * assuming it — and rather than loosening the pattern to `\d+ of`.
 */
async function fetchSignupCount(
  api: ApiClient,
  eventId: number,
): Promise<{ count: number; max: number }> {
  const ev = await api.get<{
    signupCount?: number;
    maxAttendees?: number | null;
  }>(`/events/${eventId}`);
  return { count: ev.signupCount ?? 0, max: ev.maxAttendees ?? 0 };
}

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

/** The author line must carry the state, not the bare community name. */
function assertAuthorMatches(e: SimpleEmbed, pattern: RegExp): void {
  if (!e.author || !pattern.test(e.author)) {
    throw new Error(`Expected author to match ${pattern}, got "${e.author}"`);
  }
}

/** The community name lives in the footer once the author carries the state. */
function assertFooterIs(e: SimpleEmbed, community: string): void {
  if ((e.footer ?? '').split(' \u00b7 ')[0] !== community) {
    throw new Error(`Expected footer to start with "${community}", got "${e.footer}"`);
  }
}

const eventEmbedPosted: SmokeTest = {
  name: 'Event embed posted to channel',
  category: 'embed',
  async run(ctx) {
    const ch = channelForTest(ctx, 0);
    const ev = await createEvent(ctx.api, 'embed-post', { ...mmoOverrides(ctx), ...(ch.gameId ? { gameId: ch.gameId } : {}) });
    try {
      const msg = await embedInChannel(ch.channelId, ev.title, ctx.config.timeoutMs);
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
    const ch = channelForTest(ctx, 1);
    const ev = await createEvent(ctx.api, 'embed-filling', { ...mmoOverrides(ctx), ...(ch.gameId ? { gameId: ch.gameId } : {}) });
    try {
      await embedInChannel(ch.channelId, ev.title, ctx.config.timeoutMs);
      await signup(ctx.api, ev.id, mmoSignupOpts(ctx, ['dps']));
      await awaitProcessing(ctx.api);
      await waitForEmbedUpdate(
        ch.channelId,
        (m) => m.embeds.some((e) => embedShowsSignupCount(e, ev.title, 1)),
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
    const ch = channelForTest(ctx, 2);
    const ev = await createEvent(ctx.api, 'embed-tentative', { ...mmoOverrides(ctx), ...(ch.gameId ? { gameId: ch.gameId } : {}) });
    try {
      await embedInChannel(ch.channelId, ev.title, ctx.config.timeoutMs);
      await signup(ctx.api, ev.id, mmoSignupOpts(ctx, ['healer']));
      await awaitProcessing(ctx.api);
      await waitForEmbedUpdate(
        ch.channelId,
        (m) => m.embeds.some((e) => embedShowsSignupCount(e, ev.title, 1)),
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
    const ch = channelForTest(ctx, 3);
    const ev = await createEvent(ctx.api, 'embed-unsignup', { ...mmoOverrides(ctx), ...(ch.gameId ? { gameId: ch.gameId } : {}) });
    try {
      await embedInChannel(ch.channelId, ev.title, ctx.config.timeoutMs);
      await signup(ctx.api, ev.id, mmoSignupOpts(ctx, ['tank']));
      await awaitProcessing(ctx.api);
      // Wait for embed to show the signup in the roster
      await waitForEmbedUpdate(
        ch.channelId,
        (m) => m.embeds.some((e) => embedShowsSignupCount(e, ev.title, 1)),
        ctx.config.timeoutMs,
      );
      await cancelSignup(ctx.api, ev.id);
      await awaitProcessing(ctx.api);
      // After cancel the count drops back to 0 on the author line (ROK-1460:
      // it used to be the `ROSTER: 0/` description header).
      await waitForEmbedUpdate(
        ch.channelId,
        (m) => m.embeds.some((e) => embedShowsSignupCount(e, ev.title, 0)),
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
    const ch = channelForTest(ctx, 4);
    const ev = await createEvent(ctx.api, 'embed-cancel', { ...mmoOverrides(ctx), ...(ch.gameId ? { gameId: ch.gameId } : {}) });
    try {
      await embedInChannel(ch.channelId, ev.title, ctx.config.timeoutMs);
      await cancelEvent(ctx.api, ev.id);
      await awaitProcessing(ctx.api);
      await waitForEmbedUpdate(
        ch.channelId,
        // ROK-1460: CANCELLED moved from the title to the author line; the
        // title keeps only its strikethrough.
        (m) =>
          m.embeds.some(
            (e) => !!e.author?.includes('CANCELLED') && !!e.title?.includes('~~'),
          ),
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
    const ch = channelForTest(ctx, 5);
    const ev = await createEvent(ctx.api, 'embed-resched', { ...mmoOverrides(ctx), ...(ch.gameId ? { gameId: ch.gameId } : {}) });
    try {
      const original = await embedInChannel(
        ch.channelId,
        ev.title,
        ctx.config.timeoutMs,
      );
      // Capture the original timestamp from the embed description
      const originalDesc = original.embeds[0]?.description ?? '';
      const originalTs = originalDesc.match(/<t:(\d+):f>/)?.[1] ?? '';
      await rescheduleEvent(ctx.api, ev.id, 180);
      await awaitProcessing(ctx.api);
      // Wait for the embed timestamp to change from the original
      await waitForEmbedUpdate(
        ch.channelId,
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
    const ch = channelForTest(ctx, 6);
    const ev = await createEvent(ctx.api, 'embed-btns', { ...mmoOverrides(ctx), ...(ch.gameId ? { gameId: ch.gameId } : {}) });
    try {
      const msg = await embedInChannel(ch.channelId, ev.title, ctx.config.timeoutMs);
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
    // Create event with the non-MMO gameId so the game filter is exercised.
    // Use channelForGame to poll the channel bound to this specific game.
    const pollCh = channelForGame(ctx, nonMmoGame.id);
    const ev = await createEvent(ctx.api, 'embed-nowow', {
      gameId: nonMmoGame.id,
      maxAttendees: 10,
    });
    try {
      await embedInChannel(pollCh, ev.title, ctx.config.timeoutMs);
      // Sign up with MMO character (which has a WoW class)
      await signup(ctx.api, ev.id, mmoSignupOpts(ctx));
      await awaitProcessing(ctx.api);
      // Re-poll for the embed (don't depend on catching the edit event)
      const found = await pollForEmbed(
        pollCh,
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

const embedChromePerState: SmokeTest = {
  name: 'Event embed chrome: per-state colour + author line (ROK-1460)',
  category: 'embed',
  async run(ctx) {
    const ch = channelForTest(ctx, 7);
    const community = await fetchCommunityName(ctx.api);
    const ev = await createEvent(ctx.api, 'embed-chrome', { ...mmoOverrides(ctx), ...(ch.gameId ? { gameId: ch.gameId } : {}) });
    try {
      await awaitProcessing(ctx.api);
      const { count, max } = await fetchSignupCount(ctx.api, ev.id);
      const msg = await embedInChannel(ch.channelId, ev.title, ctx.config.timeoutMs);
      const posted = msg.embeds[0];
      // Smoke events start 60 minutes out -> IMMINENT -> needs_you amber.
      assertEmbedColor(posted, REMINDER_AMBER);
      assertAuthorMatches(posted, imminentAuthorPattern(count, max));
      assertFooterIs(posted, community);
      await cancelEvent(ctx.api, ev.id);
      await awaitProcessing(ctx.api);
      const cancelled = await waitForEmbedUpdate(
        ch.channelId,
        (m) => m.embeds.some((e) => !!e.author?.includes('CANCELLED')),
        ctx.config.timeoutMs,
      );
      const card = cancelled.embeds.find((e) => e.author?.includes('CANCELLED'))!;
      assertEmbedColor(card, CANCELLED_RED);
      assertAuthorMatches(card, /\u2715 CANCELLED/);
      assertFooterIs(card, community);
      if (card.thumbnail) {
        throw new Error('Cancelled embed must drop the cover art (AC4)');
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
  embedChromePerState,
];
