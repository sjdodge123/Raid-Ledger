/**
 * Enrichment helpers for lineup detail responses (ROK-935).
 * Provides batch queries for ownership, wishlist, pricing, and member counts.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Pricing data for a single game. */
export interface GamePricing {
  itadCurrentPrice: number | null;
  itadCurrentCut: number | null;
  itadCurrentShop: string | null;
  itadCurrentUrl: string | null;
}

/**
 * Count how many users own each game (source=steam_library).
 * Returns a Map of gameId to owner count.
 */
export async function countOwnersPerGame(
  db: Db,
  gameIds: number[],
): Promise<Map<number, number>> {
  if (gameIds.length === 0) return new Map();

  const rows = await db
    .select({
      gameId: schema.gameInterests.gameId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.gameInterests)
    .where(
      and(
        inArray(schema.gameInterests.gameId, gameIds),
        eq(schema.gameInterests.source, 'steam_library'),
      ),
    )
    .groupBy(schema.gameInterests.gameId);

  return new Map(rows.map((r) => [r.gameId, r.count]));
}

/**
 * Count how many users have each game on their Steam wishlist.
 * Returns a Map of gameId to wishlist count.
 */
export async function countWishlistPerGame(
  db: Db,
  gameIds: number[],
): Promise<Map<number, number>> {
  if (gameIds.length === 0) return new Map();

  const rows = await db
    .select({
      gameId: schema.gameInterests.gameId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.gameInterests)
    .where(
      and(
        inArray(schema.gameInterests.gameId, gameIds),
        eq(schema.gameInterests.source, 'steam_wishlist'),
      ),
    )
    .groupBy(schema.gameInterests.gameId);

  return new Map(rows.map((r) => [r.gameId, r.count]));
}

/**
 * Fetch ITAD pricing metadata for a batch of games.
 * Returns a Map of gameId to pricing data.
 */
export async function fetchPricingMetadata(
  db: Db,
  gameIds: number[],
): Promise<Map<number, GamePricing>> {
  if (gameIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: schema.games.id,
      itadCurrentPrice: schema.games.itadCurrentPrice,
      itadCurrentCut: schema.games.itadCurrentCut,
      itadCurrentShop: schema.games.itadCurrentShop,
      itadCurrentUrl: schema.games.itadCurrentUrl,
    })
    .from(schema.games)
    .where(inArray(schema.games.id, gameIds));

  return new Map(
    rows.map((r) => [
      r.id,
      {
        itadCurrentPrice: r.itadCurrentPrice
          ? Number(r.itadCurrentPrice)
          : null,
        itadCurrentCut: r.itadCurrentCut,
        itadCurrentShop: r.itadCurrentShop,
        itadCurrentUrl: r.itadCurrentUrl,
      },
    ]),
  );
}

/**
 * Count total registered community members.
 */
export async function countTotalMembers(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(schema.users);

  return row?.count ?? 0;
}
