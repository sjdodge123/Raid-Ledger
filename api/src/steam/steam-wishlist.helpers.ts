/**
 * Pure diff logic and query helpers for Steam wishlist sync (ROK-418).
 */
import { and, eq, sql, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { SteamWishlistEntryDto } from '@raid-ledger/contract';
import type { SteamWishlistItem } from './steam-http.util';

/** Input for the pure diff function. */
export interface WishlistDiffInput {
  steamItems: SteamWishlistItem[];
  matchedGames: { id: number; steamAppId: number | null }[];
  existingGameIds: Set<number>;
  userId: number;
}

/** Row to insert into game_interests. */
export interface WishlistInsertRow {
  userId: number;
  gameId: number;
  source: 'steam_wishlist';
  lastSyncedAt: Date;
}

/** Result of the pure diff computation. */
export interface WishlistDiffResult {
  toInsert: WishlistInsertRow[];
  toRemoveGameIds: number[];
}

/**
 * Compute which wishlist entries to insert or remove.
 * Pure function — no DB calls.
 */
export function computeWishlistDiff(
  input: WishlistDiffInput,
): WishlistDiffResult {
  const { steamItems, matchedGames, existingGameIds, userId } = input;
  const gamesWithAppId = matchedGames.filter(
    (g): g is typeof g & { steamAppId: number } => g.steamAppId !== null,
  );
  const gameByAppId = new Map(gamesWithAppId.map((g) => [g.steamAppId, g]));
  const now = new Date();
  const toInsert: WishlistInsertRow[] = [];
  const currentGameIds = new Set<number>();

  for (const item of steamItems) {
    const dbGame = gameByAppId.get(item.appid);
    if (!dbGame) continue;
    currentGameIds.add(dbGame.id);
    if (!existingGameIds.has(dbGame.id)) {
      toInsert.push({
        userId,
        gameId: dbGame.id,
        source: 'steam_wishlist',
        lastSyncedAt: now,
      });
    }
  }

  const toRemoveGameIds = [...existingGameIds].filter(
    (id) => !currentGameIds.has(id),
  );

  return { toInsert, toRemoveGameIds };
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Fetch existing Steam wishlist game IDs for a user.
 */
export async function fetchExistingWishlistIds(
  db: Db,
  userId: number,
  schemaRef: typeof schema,
): Promise<Set<number>> {
  const rows = await db
    .select({ gameId: schemaRef.gameInterests.gameId })
    .from(schemaRef.gameInterests)
    .where(
      and(
        eq(schemaRef.gameInterests.userId, userId),
        eq(schemaRef.gameInterests.source, 'steam_wishlist'),
      ),
    );
  return new Set(rows.map((r) => r.gameId));
}

/** Steam wishlist select columns. */
const WISHLIST_COLUMNS = (s: typeof schema) =>
  ({
    gameId: s.gameInterests.gameId,
    gameName: s.games.name,
    coverUrl: s.games.coverUrl,
    slug: s.games.slug,
    createdAt: s.gameInterests.createdAt,
  }) as const;

/** Map raw rows to wishlist entry DTOs. */
function mapWishlistRows(
  rows: {
    gameId: number;
    gameName: string;
    coverUrl: string | null;
    slug: string;
    createdAt: Date;
  }[],
): SteamWishlistEntryDto[] {
  return rows.map((row) => ({
    gameId: row.gameId,
    gameName: row.gameName,
    coverUrl: row.coverUrl,
    slug: row.slug,
    dateAdded: Math.floor(row.createdAt.getTime() / 1000),
  }));
}

/**
 * Fetch paginated Steam wishlist for a user.
 */
export async function fetchSteamWishlist(
  db: Db,
  userId: number,
  page: number,
  limit: number,
  schemaRef: typeof schema,
): Promise<{ data: SteamWishlistEntryDto[]; total: number }> {
  const offset = (page - 1) * limit;
  const whereClause = and(
    eq(schemaRef.gameInterests.userId, userId),
    eq(schemaRef.gameInterests.source, 'steam_wishlist'),
  );
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schemaRef.gameInterests)
    .where(whereClause);
  const rows = await db
    .select(WISHLIST_COLUMNS(schemaRef))
    .from(schemaRef.gameInterests)
    .innerJoin(
      schemaRef.games,
      eq(schemaRef.gameInterests.gameId, schemaRef.games.id),
    )
    .where(whereClause)
    .orderBy(desc(schemaRef.gameInterests.createdAt))
    .limit(limit)
    .offset(offset);
  return {
    data: mapWishlistRows(rows),
    total: Number(countResult.count),
  };
}
