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
