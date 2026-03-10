/**
 * Steam-specific interest queries for game detail page (ROK-745, ROK-774).
 * Extracted from igdb-interest.helpers.ts for file size compliance.
 */
import { and, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Column selection for player preview queries. */
const PLAYER_PREVIEW_COLS = {
  id: schema.users.id,
  username: schema.users.username,
  avatar: schema.users.avatar,
  customAvatarUrl: schema.users.customAvatarUrl,
  discordId: schema.users.discordId,
} as const;

/** Count users who own a game via Steam (source = 'steam_library'). */
export async function getSteamOwnerCount(
  db: Db,
  gameId: number,
): Promise<number> {
  return countBySource(db, gameId, 'steam_library');
}

/** Count users who wishlisted a game via Steam (source = 'steam_wishlist'). */
export async function getSteamWishlistCount(
  db: Db,
  gameId: number,
): Promise<number> {
  return countBySource(db, gameId, 'steam_wishlist');
}

/** Check if a user has wishlisted a game via Steam. */
export async function isWishlistedByUser(
  db: Db,
  gameId: number,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.gameInterests.id })
    .from(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.gameId, gameId),
        eq(schema.gameInterests.userId, userId),
        eq(schema.gameInterests.source, 'steam_wishlist'),
      ),
    )
    .limit(1);
  return !!row;
}

/** Fetch first 8 Steam owners for avatar display (ROK-745). */
export async function getSteamOwners(db: Db, gameId: number) {
  return fetchPlayersBySource(db, gameId, 'steam_library');
}

/** Fetch first 8 Steam wishlisters for avatar display (ROK-774). */
export async function getSteamWishlisters(db: Db, gameId: number) {
  return fetchPlayersBySource(db, gameId, 'steam_wishlist');
}

/** Count interest rows for a given source. */
async function countBySource(
  db: Db,
  gameId: number,
  source: string,
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.gameId, gameId),
        eq(schema.gameInterests.source, source),
      ),
    );
  return result?.count ?? 0;
}

/** Fetch player previews filtered by interest source. */
async function fetchPlayersBySource(db: Db, gameId: number, source: string) {
  const rows = await db
    .select(PLAYER_PREVIEW_COLS)
    .from(schema.gameInterests)
    .innerJoin(schema.users, eq(schema.gameInterests.userId, schema.users.id))
    .where(
      and(
        eq(schema.gameInterests.gameId, gameId),
        eq(schema.gameInterests.source, source),
      ),
    )
    .orderBy(schema.gameInterests.createdAt)
    .limit(8);

  return rows.map((p) => ({
    id: p.id,
    username: p.username,
    avatar: p.avatar,
    customAvatarUrl: p.customAvatarUrl,
    discordId: p.discordId,
  }));
}
