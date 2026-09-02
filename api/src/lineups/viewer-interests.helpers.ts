/**
 * ROK-1314 — viewer badge personalization lookup.
 *
 * One batched `game_interests` read keyed on the game ids a response has
 * ALREADY loaded, so no path pays an N+1. Ownership semantics are fixed by
 * spec §2 decision 4:
 *   currentUserOwns       <=> game_interests.source = 'steam_library'
 *   currentUserWishlisted <=> game_interests.source = 'steam_wishlist'
 * A `manual` heart is the separate want-to-play concept and is NOT ownership.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The two personalization booleans a badge row renders. */
export interface ViewerGameFlags {
  currentUserOwns: boolean;
  currentUserWishlisted: boolean;
}

/** Both flags false — the anonymous / uninvolved answer (spec §4.5). */
export const NO_VIEWER_FLAGS: ViewerGameFlags = {
  currentUserOwns: false,
  currentUserWishlisted: false,
};

/** Per-game viewer flags, keyed by `games.id`. */
export type ViewerInterestMap = Map<number, ViewerGameFlags>;

/**
 * Load the viewer's steam-library / steam-wishlist flags for `gameIds`.
 *
 * Returns an EMPTY map (never a query) when there is no authenticated viewer
 * or no games to look up — callers then fall back to `NO_VIEWER_FLAGS`, which
 * is how spec §4.5's "explicit false, never undefined, never 401" is met.
 */
export async function loadViewerInterests(
  db: Db,
  viewerId: number | null | undefined,
  gameIds: number[],
): Promise<ViewerInterestMap> {
  const map: ViewerInterestMap = new Map();
  if (viewerId == null || gameIds.length === 0) return map;

  const rows = await db
    .select({
      gameId: schema.gameInterests.gameId,
      source: schema.gameInterests.source,
    })
    .from(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.userId, viewerId),
        inArray(schema.gameInterests.gameId, gameIds),
        inArray(schema.gameInterests.source, [
          'steam_library',
          'steam_wishlist',
        ]),
      ),
    );

  for (const row of rows) {
    const flags = map.get(row.gameId) ?? { ...NO_VIEWER_FLAGS };
    if (row.source === 'steam_library') flags.currentUserOwns = true;
    if (row.source === 'steam_wishlist') flags.currentUserWishlisted = true;
    map.set(row.gameId, flags);
  }
  return map;
}

/**
 * Read a game's viewer flags out of the map, defaulting to explicit `false`
 * for both — never `undefined` (spec §4.5).
 */
export function viewerFlagsFor(
  map: ViewerInterestMap,
  gameId: number,
): ViewerGameFlags {
  return map.get(gameId) ?? { ...NO_VIEWER_FLAGS };
}
