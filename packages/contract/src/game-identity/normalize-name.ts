/**
 * Game-name normalization for dedup comparison (ROK-1008, ROK-1113).
 *
 * Moved here from the api unchanged (ROK-1668) so every service that decides
 * "are these the same game?" shares one implementation. Same regexes, same
 * step order — `api/src/common/testing/game-name-corpus.ts` pins the output.
 *
 * Subtitle stripping in `normalizeForDedup` is aggressive — it collapses
 * "Game: Subtitle" into "game subtitle". A token-count parity check
 * (`namesMatch`) keeps "Doom" from colliding with "Doom: Eternal" (1 vs 2
 * tokens) while still allowing "Slay the Spire 2" / "Slay the Spire II".
 *
 * SQL copies of this rule (the one-shot `nkey` CTE in migration 0292) are NOT
 * kept in sync — never copy one into a new migration; derive from this file.
 * If a hub ever stores normalised names (relay crosswalk kind
 * `normalized_name`), a change here becomes a stored-identity change and needs
 * versioning.
 */
import { ROMAN_ARABIC_PAIRS } from './roman-numerals.js';

/**
 * Roman numeral replacements, derived from the canonical pair list in
 * `./roman-numerals` (ROK-1053) so the two modules cannot drift. The list is
 * already ordered longest-first, which is what keeps "VIII" from being
 * matched as "VII" + a stray "I".
 */
const ROMAN_REPLACEMENTS: [RegExp, string][] = ROMAN_ARABIC_PAIRS.map(
  ([roman, arabic]) => [new RegExp(`\\b${roman}\\b`, 'gi'), arabic],
);

/**
 * Normalize a game name for deduplication comparison.
 * - Lowercase
 * - Replace Roman numerals at word boundaries with Arabic equivalents
 * - Strip subtitle separator punctuation (colons, dashes surrounded by space)
 * - Collapse whitespace
 */
export function normalizeForDedup(name: string): string {
  if (!name) return '';
  let result = name.toLowerCase();
  for (const [pattern, replacement] of ROMAN_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  // Strip colons (subtitle separators)
  result = result.replace(/\s*:\s*/g, ' ');
  // Strip dashes acting as subtitle separators (surrounded by whitespace)
  result = result.replace(/\s+-\s+/g, ' ');
  // ROK-2164: the Unicode "dash used as a separator" family is a subtitle
  // separator too ("Asgard's Fall — Viking Survivors" vs "Asgard's Fall:
  // Viking Survivors"). The class is the contiguous range U+2012..U+2015:
  // figure dash, en dash, em dash, horizontal bar. Folded spaced, unspaced OR
  // one-sided: unlike the ASCII hyphen, none is word-internal in a title
  // ("Half-Life" keeps its hyphen). Deliberately NOT in the class: the ASCII
  // hyphen, U+2212 minus and U+FF0D fullwidth hyphen-minus, which behave like
  // hyphens inside words. Known limit: an unspaced en dash does not equal a
  // hyphen ("Paris–Dakar" -> "paris dakar", "Paris-Dakar" -> "paris-dakar").
  result = result.replace(/\s*[\u2012-\u2015]\s*/g, ' ');
  // Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/** Token count for a normalized name. */
export function tokenCount(normalized: string): number {
  if (!normalized) return 0;
  return normalized.split(' ').filter(Boolean).length;
}

/** True when two normalized names match AND have the same token count. */
export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a !== b) return false;
  return tokenCount(a) === tokenCount(b);
}
