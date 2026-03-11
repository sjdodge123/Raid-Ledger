/**
 * Post-search sorting: rank results by community interest then alphabetically.
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

/** Sort search results: interested users desc, then name asc. */
export async function sortByInterestCount(
  db: PostgresJsDatabase<typeof schema>,
  result: SearchResult,
): Promise<SearchResult> {
  if (result.games.length <= 1) return result;
  const ids = result.games.map((g) => g.id);
  const countMap = await fetchInterestCounts(db, ids);
  const sorted = [...result.games].sort((a, b) => {
    const ca = countMap.get(a.id) ?? 0;
    const cb = countMap.get(b.id) ?? 0;
    if (cb !== ca) return cb - ca;
    return a.name.localeCompare(b.name);
  });
  return { ...result, games: sorted };
}
