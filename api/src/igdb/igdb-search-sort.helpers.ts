/**
 * Post-search sorting: rank results by relevance tier, popularity, community
 * interest, name length, then alphabetically (ROK-1602).
 */
import { sql, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { gameInterests } from '../drizzle/schema';
import type { SearchResult } from './igdb.constants';
import {
  isAcronymQuery,
  nameAcronym,
  stripSearchPunctuation,
} from '../common/search.util';

/** Fetch interest counts for a set of game IDs. */
async function fetchInterestCounts(
  db: PostgresJsDatabase<typeof schema>,
  ids: number[],
): Promise<Map<number, number>> {
  try {
    const counts = await db
      .select({
        gameId: gameInterests.gameId,
        cnt: sql<number>`count(distinct ${gameInterests.userId})`,
      })
      .from(gameInterests)
      .where(inArray(gameInterests.gameId, ids))
      .groupBy(gameInterests.gameId);
    return new Map(counts.map((r) => [r.gameId, Number(r.cnt)]));
  } catch {
    return new Map();
  }
}

/**
 * Relevance tier for how well a game name matches the query (ROK-1602).
 * Higher = better. Both sides are punctuation-stripped + lowercased, and the
 * tiers mirror the SQL `gameRelevanceOrder` so the DB `LIMIT` keeps the same
 * rows this re-sort ranks first:
 *   6 = exact name
 *   5 = exact acronym ("wow" -> "World of Warcraft")
 *   4 = leading whole word ("WoW: Forever") or acronym prefix ("World of Warcraft Classic")
 *   3 = name starts with the query ("Wowo Island")
 *   2 = name contains the query
 *   1 = anything else (e.g. an IGDB/ITAD alternative-name hit)
 */
export function computeRelevance(name: string, query: string): number {
  const n = stripSearchPunctuation(name).toLowerCase();
  const q = stripSearchPunctuation(query).toLowerCase();
  if (!q) return 1;
  if (n === q) return 6;
  const acronym = isAcronymQuery(q) ? nameAcronym(name) : '';
  if (acronym === q) return 5;
  if (n.startsWith(`${q} `) || (acronym && acronym.startsWith(q))) return 4;
  if (n.startsWith(q)) return 3;
  if (n.includes(q)) return 2;
  return 1;
}

/** Minimal game shape {@link compareSearchRank} reads. */
interface RankableGame {
  id: number;
  name: string;
  popularity?: number | null;
}

/**
 * Comparator for search results: relevance tier desc, IGDB popularity desc
 * (nulls last), community interest desc, shorter name, then alphabetical.
 */
export function compareSearchRank(
  a: RankableGame,
  b: RankableGame,
  query: string,
  interest: Map<number, number>,
): number {
  const byTier =
    computeRelevance(b.name, query) - computeRelevance(a.name, query);
  if (byTier !== 0) return byTier;
  const byPopularity = (b.popularity ?? -1) - (a.popularity ?? -1);
  if (byPopularity !== 0) return byPopularity;
  const byInterest = (interest.get(b.id) ?? 0) - (interest.get(a.id) ?? 0);
  if (byInterest !== 0) return byInterest;
  if (a.name.length !== b.name.length) return a.name.length - b.name.length;
  return a.name.localeCompare(b.name);
}

/** Sort results with {@link compareSearchRank}, fetching interest counts once. */
export async function sortByRelevance(
  db: PostgresJsDatabase<typeof schema>,
  result: SearchResult,
  query: string,
): Promise<SearchResult> {
  if (result.games.length <= 1) return result;
  const ids = result.games.map((g) => g.id);
  const countMap = await fetchInterestCounts(db, ids);
  const sorted = [...result.games].sort((a, b) =>
    compareSearchRank(a, b, query, countMap),
  );
  return { ...result, games: sorted };
}
