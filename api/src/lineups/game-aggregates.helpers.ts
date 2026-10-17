/**
 * ROK-1314 follow-up — community-wide owner / wishlist aggregates for the
 * `GameDetailDto` surfaces (`/games/search`, `/games/discover`, `/games/:id`).
 *
 * These are deliberately served on the PUBLIC path rather than reusing the
 * existing `GameInterestResponseDto.ownerCount`: both interest endpoints
 * (`/games/:id/interest`, `/games/interest/batch`) are JWT-guarded, and AC4
 * requires an anonymous visitor to still see the aggregate counts. So the
 * aggregate cannot come from there.
 *
 * Same source semantics as the per-viewer lookup (spec §2 decision 4):
 * ownership is `steam_library`, wishlist is `steam_wishlist`, and a `manual`
 * heart is the separate want-to-play concept that must NOT inflate either.
 * That also keeps this count distinct from the heart count the card's
 * `useWantToPlay` badge already shows.
 */
import { inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Community-wide counts a badge row renders alongside the viewer's own pills. */
export interface GameAggregateCounts {
  ownerCount: number;
  wishlistCount: number;
}

/** Nobody owns or wishlists it — the answer for an unreferenced game. */
export const NO_AGGREGATES: GameAggregateCounts = {
  ownerCount: 0,
  wishlistCount: 0,
};

/** Per-game aggregate counts, keyed by `games.id`. */
export type GameAggregateMap = Map<number, GameAggregateCounts>;

/**
 * One grouped read over the game ids a response has ALREADY loaded — no N+1,
 * and no dependence on an authenticated viewer. Distinct users are counted, so
 * a user holding several rows for one game cannot inflate the tally.
 */
export async function loadGameAggregates(
  db: Db,
  gameIds: number[],
): Promise<GameAggregateMap> {
  const map: GameAggregateMap = new Map();
  if (gameIds.length === 0) return map;

  const rows = (await db
    .select({
      gameId: schema.gameInterests.gameId,
      ownerCount: sql<number>`COUNT(DISTINCT ${schema.gameInterests.userId})
        FILTER (WHERE ${schema.gameInterests.source} = 'steam_library')::int`,
      wishlistCount: sql<number>`COUNT(DISTINCT ${schema.gameInterests.userId})
        FILTER (WHERE ${schema.gameInterests.source} = 'steam_wishlist')::int`,
    })
    .from(schema.gameInterests)
    .where(inArray(schema.gameInterests.gameId, gameIds))
    .groupBy(schema.gameInterests.gameId)) as Array<{
    gameId: number;
    ownerCount: number;
    wishlistCount: number;
  }>;

  for (const row of rows) {
    map.set(row.gameId, {
      ownerCount: Number(row.ownerCount) || 0,
      wishlistCount: Number(row.wishlistCount) || 0,
    });
  }
  return map;
}

/** Aggregates for one game, defaulting to explicit zeroes (never undefined). */
export function aggregatesFor(
  map: GameAggregateMap,
  gameId: number,
): GameAggregateCounts {
  return map.get(gameId) ?? NO_AGGREGATES;
}
