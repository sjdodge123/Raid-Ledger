/**
 * Post-search sorting: rank results by relevance, community interest,
 * then alphabetically.
 */
import { sql, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { gameInterests } from '../drizzle/schema';
import type { SearchResult } from './igdb.constants';

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
 * Compute a relevance score for how well a game name matches the query.
 * Higher = better match.
 *   4 = exact match
 *   3 = name starts with query
 *   2 = name contains the full query phrase
 *   1 = individual words match (default for any result)
 */
export function computeRelevance(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (n === q) return 4;
  if (n.startsWith(q)) return 3;
  if (n.includes(q)) return 2;
  return 1;
}

/** Sort results: relevance desc, interest count desc, name asc. */
export async function sortByRelevance(
  db: PostgresJsDatabase<typeof schema>,
  result: SearchResult,
  query: string,
): Promise<SearchResult> {
  if (result.games.length <= 1) return result;
  const ids = result.games.map((g) => g.id);
  const countMap = await fetchInterestCounts(db, ids);
  const sorted = [...result.games].sort((a, b) => {
    const ra = computeRelevance(a.name, query);
    const rb = computeRelevance(b.name, query);
    if (rb !== ra) return rb - ra;
    const ca = countMap.get(a.id) ?? 0;
    const cb = countMap.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;
    return a.name.localeCompare(b.name);
  });
  return { ...result, games: sorted };
}
