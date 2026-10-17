/**
 * Game-name relevance SQL shared by every game search surface (ROK-1531,
 * ROK-1602): the web `/games/search` pipeline and the Discord `/bind`,
 * `/playing`, `/event create` and `/lfg` autocompletes.
 *
 * The in-memory re-sort (`computeRelevance` in `igdb-search-sort.helpers`)
 * mirrors these tiers; keep the two in step.
 */
import { and, or, sql, type SQL } from 'drizzle-orm';
import {
  buildWordMatchFilters,
  escapeLikePattern,
  isAcronymQuery,
  stripSearchPunctuation,
} from '../common/search.util';
import * as schema from '../drizzle/schema';

/**
 * `games.name` normalized exactly the way `stripSearchPunctuation` normalizes
 * the query: punctuation dropped, runs of whitespace collapsed to one space,
 * then trimmed. Collapsing matters — "Dungeons & Dragons Online" loses the `&`
 * and would otherwise keep a double space that no typed query can produce, so
 * the exact tier would silently miss every title with spaced punctuation.
 */
const NORMALIZED_GAME_NAME = sql`btrim(regexp_replace(regexp_replace(${schema.games.name}, '[^a-zA-Z0-9 ]', '', 'g'), '\\s+', ' ', 'g'))`;

/**
 * Word initials of the normalized name, lowercased — "World of Warcraft" ->
 * "wow". Mirrors `nameAcronym` in `common/search.util`. Only evaluated for
 * acronym-shaped queries (`isAcronymQuery`), so other searches pay nothing.
 */
const GAME_NAME_ACRONYM = sql`regexp_replace(lower(${NORMALIZED_GAME_NAME}), '(\\w)\\w*\\s*', '\\1', 'g')`;

/** Popularity, then shorter, then alphabetical — the tie-break tail. */
function relevanceTail(): SQL[] {
  return [
    sql`${schema.games.popularity} DESC NULLS LAST`,
    sql`length(${schema.games.name}) ASC`,
    sql`${schema.games.name} ASC`,
  ];
}

/** The single tier CASE: 0 exact .. 5 no textual match (e.g. alias hit). */
function relevanceTierCase(normalized: string): SQL {
  const q = escapeLikePattern(normalized);
  const acronym = isAcronymQuery(normalized);
  const exactAcronym = acronym
    ? sql` WHEN ${GAME_NAME_ACRONYM} = ${normalized} THEN 1`
    : sql``;
  const acronymPrefix = acronym
    ? sql` OR ${GAME_NAME_ACRONYM} LIKE ${`${q}%`}`
    : sql``;
  return sql`CASE WHEN ${NORMALIZED_GAME_NAME} ILIKE ${q} THEN 0${exactAcronym} WHEN ${NORMALIZED_GAME_NAME} ILIKE ${`${q} %`}${acronymPrefix} THEN 2 WHEN ${NORMALIZED_GAME_NAME} ILIKE ${`${q}%`} THEN 3 WHEN ${NORMALIZED_GAME_NAME} ILIKE ${`%${q}%`} THEN 4 ELSE 5 END`;
}

/**
 * ORDER BY fragments ranking games against a typed query.
 *
 * Tiers: exact name, exact acronym, leading whole word OR acronym prefix,
 * name prefix, infix, anything else. Ties: IGDB `popularity` — a plain column,
 * deliberately NOT a join, so Discord's 3s autocomplete budget holds — then
 * shorter titles, then alphabetical.
 *
 * @param value - Raw user query; punctuation-stripped + lowercased here.
 * @returns ORDER BY fragments to spread into `.orderBy(...)`.
 */
export function gameRelevanceOrder(value: string): SQL[] {
  const normalized = stripSearchPunctuation(value).toLowerCase();
  if (normalized.length === 0) return relevanceTail();
  return [relevanceTierCase(normalized), ...relevanceTail()];
}

/**
 * WHERE predicate for a game-name search: every query word appears in the name
 * (`buildWordMatchFilters`), OR — for an acronym-shaped query — the name's word
 * initials start with it, so "wow" reaches "World of Warcraft" (ROK-1602).
 *
 * Cost: the word filter already wraps the column in `regexp_replace` (no
 * trigram index), so this adds one more per-row expression to the same scan,
 * and only for single 3-8 letter queries.
 *
 * @param value - Raw user query.
 * @returns The predicate, or undefined when the query is empty.
 */
export function buildGameNameMatchFilter(value: string): SQL | undefined {
  const words = buildWordMatchFilters(schema.games.name, value);
  if (words.length === 0) return undefined;
  const wordMatch = and(...words)!;
  const normalized = stripSearchPunctuation(value).toLowerCase();
  if (!isAcronymQuery(normalized)) return wordMatch;
  const prefix = `${escapeLikePattern(normalized)}%`;
  return or(wordMatch, sql`${GAME_NAME_ACRONYM} LIKE ${prefix}`)!;
}
