/**
 * ROK-1314 — badge data for veto tiebreaker cards (spec §4.4).
 *
 * Veto cards render the COMPACT badge set: owner/wishlist aggregates, the
 * viewer's own two flags, and the three price scalars. One aggregate query
 * over the tied game ids plus one batched viewer lookup — no N+1.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  loadViewerInterests,
  viewerFlagsFor,
  NO_VIEWER_FLAGS,
} from '../viewer-interests.helpers';
import {
  countOwnersPerGame,
  countWishlistPerGame,
} from '../lineups-enrichment.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Compact badge payload for a single veto card. */
export interface VetoGameBadges {
  ownerCount: number;
  wishlistCount: number;
  currentUserOwns: boolean;
  currentUserWishlisted: boolean;
  itadCurrentPrice: number | null;
  itadCurrentCut: number | null;
  itadLowestPrice: number | null;
}

/** Per-game badge payloads, keyed by `games.id`. */
export type VetoBadgeMap = Map<number, VetoGameBadges>;

/** Zeroed badges — the answer for a game with no interests and no pricing. */
const EMPTY_BADGES: VetoGameBadges = {
  ownerCount: 0,
  wishlistCount: 0,
  ...NO_VIEWER_FLAGS,
  itadCurrentPrice: null,
  itadCurrentCut: null,
  itadLowestPrice: null,
};

interface PriceRow {
  id: number;
  itadCurrentPrice: string | number | null;
  itadCurrentCut: number | null;
  itadLowestPrice: string | number | null;
}

/** Postgres numerics arrive as strings over postgres-js — coerce or null. */
function toNumber(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/**
 * Build the compact badge map for `gameIds`, merging the community
 * aggregates with the viewer's own flags. `viewerId == null` (anonymous)
 * yields explicit `false` on both flags — never `undefined` (spec §4.5).
 */
export async function loadVetoGameBadges(
  db: Db,
  gameIds: number[],
  viewerId?: number | null,
): Promise<VetoBadgeMap> {
  const map: VetoBadgeMap = new Map();
  if (gameIds.length === 0) return map;

  const [rows, ownerMap, wishlistMap, viewerInterests] = await Promise.all([
    db
      .select({
        id: schema.games.id,
        itadCurrentPrice: schema.games.itadCurrentPrice,
        itadCurrentCut: schema.games.itadCurrentCut,
        itadLowestPrice: schema.games.itadLowestPrice,
      })
      .from(schema.games)
      .where(inArray(schema.games.id, gameIds)),
    countOwnersPerGame(db, gameIds),
    countWishlistPerGame(db, gameIds),
    loadViewerInterests(db, viewerId, gameIds),
  ]);

  for (const row of rows as PriceRow[]) {
    map.set(row.id, {
      ownerCount: ownerMap.get(row.id) ?? 0,
      wishlistCount: wishlistMap.get(row.id) ?? 0,
      ...viewerFlagsFor(viewerInterests, row.id),
      itadCurrentPrice: toNumber(row.itadCurrentPrice),
      itadCurrentCut: row.itadCurrentCut,
      itadLowestPrice: toNumber(row.itadLowestPrice),
    });
  }
  return map;
}

/** Badges for one game, defaulting to the zeroed/false payload. */
export function vetoBadgesFor(
  map: VetoBadgeMap,
  gameId: number,
): VetoGameBadges {
  return map.get(gameId) ?? { ...EMPTY_BADGES };
}
