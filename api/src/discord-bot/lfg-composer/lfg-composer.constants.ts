import { escapeMarkdown } from 'discord.js';

/**
 * ROK-1612 — the pinned LFG composer card: ids, copy and limits.
 *
 * Every string a player reads lives here so the copy guard and the companion
 * smoke suite assert against one source. The operator cut two things on the way
 * to this design and they are recorded as rules, not comments:
 *
 *  1. **No meta-copy about staying in Discord.** "no need to leave the channel"
 *     was explicitly struck. The card's title is its only body text.
 *  2. **`View games ↗` is permanent furniture**, not a fallback that appears
 *     only when a search fails. On the public card it is a press (`VIEW`) that
 *     answers the clicker privately with their own signed-in link, so no token
 *     ever sits on a message everyone can see (ROK-1685); on the private
 *     replies it is a Link button carrying that link directly.
 */

/**
 * Custom-id prefixes. Short on purpose: Discord caps a custom id at 100
 * characters and the urgency button has to carry a game id, the back-target and
 * the typed term as well (see `lfg-composer-state.helpers`).
 */
export const LFG_COMPOSER_IDS = {
  /** The card's primary button. Opens the search modal. */
  OPEN: 'lfgc:open',
  /** The search modal itself, and the one text input inside it. */
  MODAL: 'lfgc:modal',
  INPUT: 'lfgc:game',
  /** The candidate string select on the ambiguous / fuzzy replies. */
  PICK: 'lfgc:pick',
  /** An urgency button — the one irreversible press. */
  GO: 'lfgc:go',
  /**
   * `← Back` from any results message; reopens the prefilled modal. The
   * retired dead-end `Try again` button carried this same id, so an ephemeral
   * sent before ROK-1658 still routes here unchanged.
   */
  BACK: 'lfgc:back',
  /**
   * `Back` from the urgency step when the game came from a candidate select —
   * re-renders that select (AC9). Disjoint from `BACK` because every parser
   * matches on `<prefix>:`, and `lfgc:backc:` never starts with `lfgc:back:`.
   */
  BACK_TO_CANDIDATES: 'lfgc:backc',
  /**
   * The pinned card's `View games ↗` (ROK-1685). A press, not a link: the
   * card is public, so its handler replies ephemerally with the clicker's own
   * magic link instead of one token everyone could reuse.
   */
  VIEW: 'lfgc:view',
} as const;

/**
 * Longest search term carried inside a custom id.
 *
 * The modal input is capped at the same number so a term that was typable can
 * always be handed back to `Back` intact — the alternative is a truncated
 * re-prefill, which is exactly the "never loses typed text" failure AC9 names.
 * `lfgc:go:now-30:2147483647:c:` is 29 characters, so 64 leaves head-room.
 */
export const LFG_COMPOSER_TERM_MAX = 64;

/** Discord's own ceiling on a string-select; the candidate list never exceeds it. */
export const LFG_COMPOSER_MAX_CANDIDATES = 25;

/** Card, modal and reply copy. */
export const LFG_COMPOSER_COPY = {
  /** The card's only body text. No subtitle — operator ruling 2026-09-17. */
  CARD_TITLE: 'Looking for a group?',
  /** The leading `+` is the approved prototype's label (ROK-1658), not an emoji. */
  POST_BUTTON: '+ Post an LFG',
  VIEW_GAMES_BUTTON: 'View games ↗',
  MODAL_TITLE: 'Post an LFG',
  MODAL_INPUT_LABEL: 'Game',
  MODAL_PLACEHOLDER: 'Start typing a game name',
  BACK_BUTTON: '← Back',
  SELECT_PLACEHOLDER: 'Pick a game',
  /** A press carrying an urgency the live vocabulary no longer has. */
  STALE_REPLY: 'That option has changed — press Back and pick again.',
  /** A picked game that has since left the library. */
  FAILED_REPLY: 'Something went wrong. Please try again.',
} as const;

/**
 * The typed term in curly quotes, as the approved prototype shows it (ROK-1658).
 * Escaped so `*bg3*` reads as typed rather than rendering as italics.
 */
function quoted(term: string): string {
  return `“${escapeMarkdown(term)}”`;
}

/** `3 games match “rock”` / `1 game matches “valheim”` — the results header. */
export function composerCandidatesHeading(count: number, term: string): string {
  const games = count === 1 ? 'game matches' : 'games match';
  return `${String(count)} ${games} ${quoted(term)}`;
}

/** The trigram reply. Phrased as a question because it never auto-selects. */
export function composerDidYouMeanHeading(term: string): string {
  return `No exact match for ${quoted(term)}. Did you mean:`;
}

/** Nothing found. Carries only `← Back` and `View games ↗` — no select. */
export function composerNoMatchHeading(term: string): string {
  return `No games match ${quoted(term)}`;
}

/** The urgency step names the game so the press is never ambiguous. */
export function composerUrgencyHeading(gameName: string): string {
  return `When do you want to play ${gameName}?`;
}
