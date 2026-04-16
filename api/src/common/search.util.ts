import { ilike, or, type Column, type SQL } from 'drizzle-orm';

/**
 * Strip punctuation from a search query, leaving only alphanumeric
 * characters and spaces. Collapses consecutive whitespace into a single
 * space and trims the result.
 */
export function stripSearchPunctuation(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escape special characters (`%`, `_`, `\`) in a string so they are
 * treated as literals inside an SQL LIKE / ILIKE pattern.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}

/**
 * Build an array of Drizzle `ilike` conditions — one per word in the
 * query — so that every word must appear somewhere in the column value.
 *
 * The query is first stripped of punctuation and lowercased, then split
 * on whitespace. Each word becomes `ilike(column, '%word%')`.
 *
 * Consumers should spread the result into an `and()` clause:
 * ```ts
 * const filters = buildWordMatchFilters(schema.games.name, query);
 * db.select().from(schema.games).where(and(...filters, ...otherConditions));
 * ```
 */
export function buildWordMatchFilters(column: Column, query: string): SQL[] {
  const normalized = stripSearchPunctuation(query).toLowerCase();
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  return words.map((word) => {
    const alt = romanArabicAlt(word);
    if (!alt) return ilike(column, `%${escapeLikePattern(word)}%`);
    return or(
      ilike(column, `%${escapeLikePattern(word)}%`),
      ilike(column, `%${escapeLikePattern(alt)}%`),
    )!;
  });
}

const ARABIC_TO_ROMAN: Record<string, string> = {
  '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
  '6': 'VI', '7': 'VII', '8': 'VIII',
};
const ROMAN_TO_ARABIC: Record<string, string> = {
  ii: '2', iii: '3', iv: '4', v: '5',
  vi: '6', vii: '7', viii: '8',
};

/** Return the Roman/Arabic alternative for a word, or null if none. */
function romanArabicAlt(word: string): string | null {
  if (ARABIC_TO_ROMAN[word]) return ARABIC_TO_ROMAN[word];
  return ROMAN_TO_ARABIC[word.toLowerCase()] ?? null;
}
