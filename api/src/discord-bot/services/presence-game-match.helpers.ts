/**
 * Title guard for the trigram step of presence game resolution (ROK-1504).
 *
 * pg_trgm similarity is a PREFILTER, not an acceptance test: "Revenge of the
 * Titans" vs "Revenge of the Mage" scores 0.60 (shared "revenge of the"
 * trigrams), clearing the 0.5 threshold, so the top-1 row attributed a
 * player's activity to an unrelated game. A candidate is now accepted only
 * when it is the SAME title under normalization (case, ™/®, punctuation,
 * roman↔arabic numerals) — typo-fuzzy matching is deliberately dropped;
 * Discord activity names come from publishers, not from users typing.
 */
import { titlesMatchExact } from '../../cooptimus/cooptimus-match.helpers';

/** How many similarity-ranked rows the trigram step inspects. */
export const TRIGRAM_CANDIDATE_LIMIT = 5;

/**
 * Pick the first candidate (in the given similarity-DESC order) whose title
 * equals `activityName` under normalization; null when none qualifies.
 */
export function pickNormalizedTitleMatch<
  T extends { id: number; name: string },
>(activityName: string, candidates: T[]): T | null {
  for (const candidate of candidates) {
    if (titlesMatchExact(activityName, candidate.name)) return candidate;
  }
  return null;
}
