/**
 * ROK-1612 AC9 — the composer's whole state machine, carried in custom ids.
 *
 * There is no server-side session. Every step encodes what the NEXT step needs
 * into the component it renders, so a press an hour later still knows what was
 * typed and where `Back` goes. Two consequences shape the encoding:
 *
 *  1. **The typed term is always the LAST segment**, because a search term may
 *     itself contain `:`. Parsing takes a fixed number of leading fields and
 *     rejoins the remainder — never `split(':')` into a fixed-width tuple.
 *  2. **Urgency rides as a derived key, not its raw value.** `LFG_URGENCY_CHOICES`
 *     carries `now:30`, whose colon would forge a segment boundary. The key is
 *     derived from the value (`:` -> `-`) rather than hardcoded, so ROK-1616 can
 *     re-cut the vocabulary without this file knowing the strings.
 *
 * Identity is NEVER encoded. The caller is resolved from the interaction, the
 * way `LfgJoinListener` resolves it, so a hand-crafted id posts for the presser
 * or for nobody.
 */
import {
  LFG_COMPOSER_IDS,
  LFG_COMPOSER_TERM_MAX,
} from './lfg-composer.constants';

/**
 * Which step the urgency buttons were rendered from.
 *
 * New renders always carry `'candidates'` (ROK-1658: the list is always shown).
 * `'search'` and its `s` flag in the go id are kept ONLY so an urgency button
 * rendered before ROK-1658 — still sitting in someone's ephemeral — still posts
 * instead of answering with the stale reply.
 */
export type LfgComposerOrigin = 'candidates' | 'search';

/** A pressed urgency button, fully resolved. */
export interface LfgComposerGoState {
  urgencyKey: string;
  gameId: number;
  origin: LfgComposerOrigin;
  term: string;
}

/** Truncate to what a custom id can carry, and drop surrounding whitespace. */
export function normalizeComposerTerm(term: string): string {
  return term.trim().slice(0, LFG_COMPOSER_TERM_MAX);
}

/**
 * A colon-free key for an urgency choice value.
 *
 * Derived, never hardcoded: `now:30` -> `now-30`, `week` -> `week`. ROK-1616
 * owns the vocabulary; this only has to survive it.
 *
 * @param value - A `LFG_URGENCY_CHOICES` value.
 * @returns The same value with segment separators neutralised.
 */
export function urgencyKeyFor(value: string): string {
  return value.replace(/:/g, '-');
}

/**
 * The choice value a key came from.
 *
 * @param key - The key encoded in the custom id.
 * @param choices - The live urgency vocabulary.
 * @returns The matching choice value, or null when the key is unknown — a
 *   stale card whose vocabulary has since changed must refuse, not guess.
 */
export function urgencyValueFor(
  key: string,
  choices: ReadonlyArray<{ value: string }>,
): string | null {
  const hit = choices.find((c) => urgencyKeyFor(c.value) === key);
  return hit?.value ?? null;
}

/** `lfgc:back:<term>` — reopens the modal prefilled with what was typed. */
export function buildBackCustomId(term: string): string {
  return `${LFG_COMPOSER_IDS.BACK}:${normalizeComposerTerm(term)}`;
}

/**
 * `lfgc:backc:<term>` — the urgency step's `Back`, which re-renders the select.
 *
 * The urgency step is only ever reached from the candidate select now, so its
 * Back always returns there. ROK-1658 supersedes AC9's "reopen the modal when
 * the match was unambiguous": an unambiguous match is a one-option select.
 */
export function buildBackToCandidatesCustomId(term: string): string {
  return `${LFG_COMPOSER_IDS.BACK_TO_CANDIDATES}:${normalizeComposerTerm(term)}`;
}

/** `lfgc:pick:<origin-less>:<term>` — the select carries the term for Back. */
export function buildPickCustomId(term: string): string {
  return `${LFG_COMPOSER_IDS.PICK}:${normalizeComposerTerm(term)}`;
}

/**
 * `lfgc:go:<urgencyKey>:<gameId>:<origin>:<term>`. The origin flag is `c` on
 * every new render; `s` survives only for pre-ROK-1658 buttons (see
 * {@link LfgComposerOrigin}).
 */
export function buildGoCustomId(state: LfgComposerGoState): string {
  const origin = state.origin === 'candidates' ? 'c' : 's';
  const parts = [
    LFG_COMPOSER_IDS.GO,
    urgencyKeyFor(state.urgencyKey),
    String(state.gameId),
    origin,
    normalizeComposerTerm(state.term),
  ];
  return parts.join(':');
}

/** The term out of a `lfgc:back:` or `lfgc:pick:` id, or null when malformed. */
export function parseTermCustomId(
  customId: string,
  prefix: string,
): string | null {
  const head = `${prefix}:`;
  if (!customId.startsWith(head)) return null;
  return customId.slice(head.length);
}

/**
 * Read a pressed urgency button back into state.
 *
 * @param customId - The pressed component's id.
 * @returns The state, or null when the id is not a composer urgency press or
 *   carries a game id that is not a positive integer.
 */
export function parseGoCustomId(customId: string): LfgComposerGoState | null {
  const head = `${LFG_COMPOSER_IDS.GO}:`;
  if (!customId.startsWith(head)) return null;
  const rest = customId.slice(head.length);
  const [urgencyKey, rawId, originFlag, ...termParts] = rest.split(':');
  const gameId = Number(rawId);
  const valid =
    Boolean(urgencyKey) &&
    /^\d+$/.test(rawId ?? '') &&
    Number.isSafeInteger(gameId) &&
    gameId > 0 &&
    (originFlag === 'c' || originFlag === 's');
  if (!valid) return null;
  return {
    urgencyKey,
    gameId,
    origin: originFlag === 'c' ? 'candidates' : 'search',
    term: termParts.join(':'),
  };
}

