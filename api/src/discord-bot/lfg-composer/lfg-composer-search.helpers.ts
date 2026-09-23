/**
 * ROK-1612 AC2 — four outcomes, and the rule that none of the ambiguous ones
 * may resolve themselves.
 *
 * **Never auto-select from an ambiguous or fuzzy result.** Measured against a
 * real 151-row library on 2026-09-17, `valhiem` returns `Valheim` at 0.33 AND
 * `Valorant` at 0.21 — a single-row fuzzy result is a coincidence of the
 * threshold, not a confident answer, so even one trigram hit is still offered
 * with the "Did you mean" heading rather than as a match.
 *
 * **One confident match means the search returned exactly ONE game** (`kind:
 * 'single'`), and even that renders as a one-option select (ROK-1658) so the
 * player sees the search ran and confirms the pick. An EXACT normalized title
 * — the same test `/lfg`'s `resolveGameId` makes — among several matches is
 * NOT narrowed: it is the "several candidates" row of the step-3 table, listed
 * with the exact title first (ROK-1658 amendment 2, "refer to the original
 * design").
 *
 * The classification is pure so all four outcomes are unit-testable without a
 * database; the two queries live in `lfg-composer-search.db-helpers`.
 */
import { stripSearchPunctuation } from '../../common/search.util';
import { LFG_COMPOSER_MAX_CANDIDATES } from './lfg-composer.constants';

/** The columns every composer surface needs about a game. */
export interface LfgComposerGame {
  id: number;
  name: string;
}

/**
 * What the typed term resolved to.
 *
 * `fuzzy` is kept distinct from `candidates` even though both render a select:
 * the headings differ ("N games match" vs "Did you mean") and conflating them
 * would let a future edit quietly auto-select the one-row fuzzy case.
 */
export type LfgComposerMatch =
  | { kind: 'single'; game: LfgComposerGame }
  | { kind: 'candidates'; games: LfgComposerGame[] }
  | { kind: 'fuzzy'; games: LfgComposerGame[] }
  | { kind: 'none' };

/** Punctuation-stripped, collapsed and lowercased — the comparison form. */
export function normalizeForCompare(value: string): string {
  return stripSearchPunctuation(value).toLowerCase();
}

/** The row whose normalized title IS the normalized term, if there is one. */
function exactHit(
  games: LfgComposerGame[],
  term: string,
): LfgComposerGame | undefined {
  const normalized = normalizeForCompare(term);
  if (normalized.length === 0) return undefined;
  return games.find((g) => normalizeForCompare(g.name) === normalized);
}

/**
 * Classify a word-filter result set, falling back to the trigram set.
 *
 * @param term - What the player typed.
 * @param matches - Rows from the shared word/acronym filter, already ranked.
 * @param fuzzy - Rows from the trigram re-query; only consulted when `matches`
 *   is empty, so the caller may skip that query entirely when it is not.
 * @returns One of the four AC2 outcomes.
 */
export function classifyComposerMatch(
  term: string,
  matches: LfgComposerGame[],
  fuzzy: LfgComposerGame[] = [],
): LfgComposerMatch {
  if (matches.length === 1) return { kind: 'single', game: matches[0] };
  if (matches.length > 1) {
    return {
      kind: 'candidates',
      games: capCandidates(exactFirst(matches, term)),
    };
  }
  if (fuzzy.length > 0) return { kind: 'fuzzy', games: capCandidates(fuzzy) };
  return { kind: 'none' };
}

/**
 * The exact-title row (if any) moved to the front; the rest keep their rank.
 * Runs BEFORE the cap, so an exact title ranked 26th is never cut.
 */
function exactFirst(
  games: LfgComposerGame[],
  term: string,
): LfgComposerGame[] {
  const exact = exactHit(games, term);
  return exact ? [exact, ...games.filter((g) => g !== exact)] : games;
}

/** Discord rejects a select with more than 25 options. */
function capCandidates(games: LfgComposerGame[]): LfgComposerGame[] {
  return games.slice(0, LFG_COMPOSER_MAX_CANDIDATES);
}
