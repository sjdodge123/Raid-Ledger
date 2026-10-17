/**
 * Canonical Roman/Arabic numeral pairs for game titles (ROK-1053).
 *
 * Single source of truth: search alternation (`romanArabicAlt` in the api's
 * `common/search.util`) and dedup normalization (`normalizeForDedup` in
 * `./normalize-name`) both derive their lookup from this list rather than
 * restating it. Moved here from the api unchanged (ROK-1668).
 *
 * Ordered longest Roman numeral first so a regex pass built from it matches
 * "VIII" before "VII" before "VI"; "IV" precedes "V" for the same reason.
 */
export const ROMAN_ARABIC_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['VIII', '8'],
  ['VII', '7'],
  ['VI', '6'],
  ['IV', '4'],
  ['V', '5'],
  ['III', '3'],
  ['II', '2'],
];
