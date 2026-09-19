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
 *     only when a search fails. It is a URL button, so it raises no interaction
 *     and cannot fail or time out.
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
  /** `Back`, and the dead-end `Try again`; both reopen the prefilled modal. */
  BACK: 'lfgc:back',
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
  POST_BUTTON: 'Post an LFG',
  VIEW_GAMES_BUTTON: 'View games ↗',
  MODAL_TITLE: 'Post an LFG',
  MODAL_INPUT_LABEL: 'Game',
  MODAL_PLACEHOLDER: 'Start typing a game name',
  BACK_BUTTON: '← Back',
  TRY_AGAIN_BUTTON: 'Try again',
  SELECT_PLACEHOLDER: 'Pick a game',
} as const;

/** `N games match \`rock\`` — the ambiguous header. */
export function composerCandidatesHeading(count: number, term: string): string {
  const games = count === 1 ? 'game matches' : 'games match';
  return `${String(count)} ${games} \`${term}\``;
}

/** The trigram reply. Phrased as a question because it never auto-selects. */
export function composerDidYouMeanHeading(term: string): string {
  return `No exact match for \`${term}\`. Did you mean:`;
}

/** The dead end. Offers `Try again` and `View games ↗`, never nothing. */
export function composerNoMatchHeading(term: string): string {
  return `Nothing in the library matches \`${term}\`.`;
}

/** The urgency step names the game so the press is never ambiguous. */
export function composerUrgencyHeading(gameName: string): string {
  return `When do you want to play ${gameName}?`;
}
