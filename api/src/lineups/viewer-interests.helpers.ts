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

/**
 * A map value: the two flags plus the viewer's Steam lifetime playtime
 * (ROK-1375). Playtime is kept OFF `ViewerGameFlags` so the other DTOs that
 * spread `viewerFlagsFor(...)` do not start shipping a field they never
 * declared.
 */
export interface ViewerGameEntry extends ViewerGameFlags {
  /** `playtime_forever` minutes from the steam_library row, else null. */
  playtimeMinutes: number | null;
}

/** Per-game viewer entries, keyed by `games.id`. */
export type ViewerInterestMap = Map<number, ViewerGameEntry>;

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
      // ROK-1375: same row, same query — no extra round trip for playtime.
      playtimeForever: schema.gameInterests.playtimeForever,
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
    const flags = map.get(row.gameId) ?? {
      ...NO_VIEWER_FLAGS,
      playtimeMinutes: null,
    };
    if (row.source === 'steam_library') {
      flags.currentUserOwns = true;
      flags.playtimeMinutes = row.playtimeForever ?? null;
    }
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
  const entry = map.get(gameId);
  if (!entry) return { ...NO_VIEWER_FLAGS };
  return {
    currentUserOwns: entry.currentUserOwns,
    currentUserWishlisted: entry.currentUserWishlisted,
  };
}

/**
 * ROK-1375: the viewer's lifetime Steam playtime (minutes) for a game they
 * own via `steam_library`; `null` when they do not own it or Steam reported
 * no playtime.
 */
export function viewerPlaytimeFor(
  map: ViewerInterestMap,
  gameId: number,
): number | null {
  return map.get(gameId)?.playtimeMinutes ?? null;
}

/**
 * ROK-1375: the lineup-entry personalization block — both flags (explicit
 * false) plus `currentUserPlaytimeMinutes`, which is OMITTED rather than
 * null when there is no viewer so an anonymous payload never implies
 * "signed in, owns nothing".
 */
export function viewerEntryFieldsFor(
  map: ViewerInterestMap,
  gameId: number,
  hasViewer: boolean,
): ViewerGameFlags & { currentUserPlaytimeMinutes?: number | null } {
  const flags = viewerFlagsFor(map, gameId);
  if (!hasViewer) return flags;
  return {
    ...flags,
    currentUserPlaytimeMinutes: viewerPlaytimeFor(map, gameId),
  };
}
