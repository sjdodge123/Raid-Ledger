import { and, eq, inArray, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { GameInterestResponseDto } from '@raid-ledger/contract';
import {
  getSteamOwnerCount,
  getSteamOwners,
  getSteamWishlistCount,
  isWishlistedByUser,
  getSteamWishlisters,
} from './igdb-steam-interest.helpers';
import {
  HEART_SOURCES,
  INTERESTED_ROW,
  STEAM_SYNC_SOURCES,
  USER_HEART_SOURCES,
  toDtoSource,
} from './igdb-interest-sources.helpers';
import { isGameMuted } from '../notifications/game-notification-mute.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Sources that count as "interested" (hearts). Library/wishlist are separate. */
export { HEART_SOURCES };

/** Order heart sources ahead of Steam sync rows (ROK-1796). */
const STEAM_SOURCE_LAST = sql`case when ${inArray(schema.gameInterests.source, STEAM_SYNC_SOURCES)} then 1 else 0 end`;

/** SQL expression for distinct user count (ROK-804). */
const DISTINCT_USER_COUNT = sql<number>`count(distinct ${schema.gameInterests.userId})::int`;

/**
 * Get interest count for a game (hearts only, excludes library/wishlist).
 * Uses COUNT(DISTINCT user_id) to avoid double-counting users with
 * multiple interest sources (ROK-804).
 * @param db - Database connection
 * @param gameId - Game ID
 * @returns Unique interested user count
 */
export async function getInterestCount(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
): Promise<number> {
  const [result] = await db
    .select({ count: DISTINCT_USER_COUNT })
    .from(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.gameId, gameId),
        inArray(schema.gameInterests.source, HEART_SOURCES),
      ),
    );
  return result?.count ?? 0;
}

/**
 * Get the current user's interest source for a game (ROK-1796: Steam
 * library/wishlist rows count for the per-user heart; a real heart source is
 * preferred over a Steam row when both exist; an un-heart suppression means
 * "not interested" even while Steam rows remain).
 * @param db - Database connection
 * @param gameId - Game ID
 * @param userId - User ID
 * @returns Source string or null
 */
export async function getUserInterestSource(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  userId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ source: schema.gameInterests.source })
    .from(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.gameId, gameId),
        eq(schema.gameInterests.userId, userId),
        inArray(schema.gameInterests.source, USER_HEART_SOURCES),
        INTERESTED_ROW,
      ),
    )
    .orderBy(STEAM_SOURCE_LAST)
    .limit(1);
  return row?.source ?? null;
}

/**
 * Fetch first 8 interested players for avatar display (ROK-282).
 * Uses DISTINCT ON to deduplicate users with multiple sources (ROK-804).
 * @param db - Database connection
 * @param gameId - Game ID
 * @returns Player preview list (unique users)
 */
export async function getInterestedPlayers(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
) {
  const rows = await db
    .selectDistinctOn([schema.users.id], {
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      customAvatarUrl: schema.users.customAvatarUrl,
      discordId: schema.users.discordId,
    })
    .from(schema.gameInterests)
    .innerJoin(schema.users, eq(schema.gameInterests.userId, schema.users.id))
    .where(
      and(
        eq(schema.gameInterests.gameId, gameId),
        inArray(schema.gameInterests.source, HEART_SOURCES),
      ),
    )
    .orderBy(schema.users.id, schema.gameInterests.createdAt)
    .limit(8);

  return rows.map((p) => ({
    id: p.id,
    username: p.username,
    avatar: p.avatar,
    customAvatarUrl: p.customAvatarUrl,
    discordId: p.discordId,
  }));
}

/** Fetch batch counts (hearts only, ROK-804) and the user's own hearts incl. Steam rows (ROK-1796). */
async function fetchBatchData(
  db: PostgresJsDatabase<typeof schema>,
  gameIds: number[],
  userId: number,
) {
  const gameIdFilter = inArray(schema.gameInterests.gameId, gameIds);
  const sourceFilter = inArray(schema.gameInterests.source, HEART_SOURCES);
  return Promise.all([
    db
      .select({
        gameId: schema.gameInterests.gameId,
        count: DISTINCT_USER_COUNT.as('count'),
      })
      .from(schema.gameInterests)
      .where(and(gameIdFilter, sourceFilter))
      .groupBy(schema.gameInterests.gameId),
    db
      .select({ gameId: schema.gameInterests.gameId })
      .from(schema.gameInterests)
      .where(
        and(
          gameIdFilter,
          eq(schema.gameInterests.userId, userId),
          inArray(schema.gameInterests.source, USER_HEART_SOURCES),
          INTERESTED_ROW,
        ),
      ),
  ]);
}

/**
 * Batch check interest status for multiple game IDs.
 * @param db - Database connection
 * @param gameIds - Array of game IDs
 * @param userId - Current user's ID
 * @returns Map of gameId -> interest status
 */
export async function batchCheckInterests(
  db: PostgresJsDatabase<typeof schema>,
  gameIds: number[],
  userId: number,
): Promise<Record<string, { wantToPlay: boolean; count: number }>> {
  const [counts, userInterests] = await fetchBatchData(db, gameIds, userId);
  const countMap = new Map(counts.map((c) => [c.gameId, c.count]));
  const userSet = new Set(userInterests.map((i) => i.gameId));

  const data: Record<string, { wantToPlay: boolean; count: number }> = {};
  for (const id of gameIds) {
    data[String(id)] = {
      wantToPlay: userSet.has(id),
      count: countMap.get(id) ?? 0,
    };
  }
  return data;
}

/**
 * Add want-to-play interest and return updated response.
 * @param db - Database connection
 * @param gameId - Game ID
 * @param userId - User ID
 * @returns Interest response DTO
 */
export async function addInterest(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  userId: number,
): Promise<GameInterestResponseDto> {
  // A manual re-heart lifts any earlier un-heart suppression (ROK-1796).
  // Clear it BEFORE inserting the heart: against a concurrent removeInterest
  // (delete heart → insert suppression) every interleaving then ends with the
  // heart, the suppression, or both (heart wins) — never neither.
  await db
    .delete(schema.gameInterestSuppressions)
    .where(
      and(
        eq(schema.gameInterestSuppressions.userId, userId),
        eq(schema.gameInterestSuppressions.gameId, gameId),
      ),
    );
  await db
    .insert(schema.gameInterests)
    .values({ userId, gameId, source: 'manual' })
    .onConflictDoNothing();

  const [count, players, notificationsMuted] = await Promise.all([
    getInterestCount(db, gameId),
    getInterestedPlayers(db, gameId),
    isGameMuted(db, userId, gameId),
  ]);
  return {
    wantToPlay: true,
    count,
    players,
    source: 'manual' as const,
    notificationsMuted,
  };
}

/**
 * Remove want-to-play interest (ROK-444, ROK-1031, ROK-1796).
 *
 * Deletes only the HEART-source rows; Steam library/wishlist rows stay, since
 * ownership and playtime are facts ~20 other features read. ALWAYS records a
 * suppression — whatever backed the heart — so the per-user heart, the
 * interest-driven DMs and every auto-heart path (Discord activity, poll
 * votes) treat the pair as "not interested" until a manual re-heart. Both
 * writes share one transaction so neither can land without the other.
 * @param db - Database connection
 * @param gameId - Game ID
 * @param userId - User ID
 * @returns Interest response DTO
 */
export async function removeInterest(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  userId: number,
): Promise<GameInterestResponseDto> {
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.gameInterests)
      .where(
        and(
          eq(schema.gameInterests.gameId, gameId),
          eq(schema.gameInterests.userId, userId),
          inArray(schema.gameInterests.source, HEART_SOURCES),
        ),
      );
    await tx
      .insert(schema.gameInterestSuppressions)
      .values({ userId, gameId })
      .onConflictDoNothing();
  });

  const [count, players, notificationsMuted] = await Promise.all([
    getInterestCount(db, gameId),
    getInterestedPlayers(db, gameId),
    isGameMuted(db, userId, gameId),
  ]);
  return { wantToPlay: false, count, players, notificationsMuted };
}

/** Build the parallel query array for game interest data. */
function interestQueries(db: Db, gameId: number, userId: number) {
  return [
    getInterestCount(db, gameId),
    getUserInterestSource(db, gameId, userId),
    getInterestedPlayers(db, gameId),
    getSteamOwnerCount(db, gameId),
    getSteamOwners(db, gameId),
    getSteamWishlistCount(db, gameId),
    isWishlistedByUser(db, gameId, userId),
    getSteamWishlisters(db, gameId),
  ] as const;
}

/**
 * Fetch all interest-related data for a game in parallel.
 * Used by getGameInterest controller method.
 */
export async function fetchGameInterestData(
  db: Db,
  gameId: number,
  userId: number,
) {
  const [
    count,
    source,
    players,
    ownerCount,
    owners,
    wishlistedCount,
    wishlistedByMe,
    wishlisters,
  ] = await Promise.all(interestQueries(db, gameId, userId));
  return {
    count,
    source,
    players,
    ownerCount,
    owners,
    wishlistedCount,
    wishlistedByMe,
    wishlisters,
  };
}

/** Fetch interest data and map to the API response DTO. */
export async function fetchGameInterestResponse(
  db: Db,
  gameId: number,
  userId: number,
): Promise<GameInterestResponseDto> {
  const [d, notificationsMuted] = await Promise.all([
    fetchGameInterestData(db, gameId, userId),
    isGameMuted(db, userId, gameId),
  ]);
  return {
    wantToPlay: d.source !== null,
    count: d.count,
    players: d.players,
    source: toDtoSource(d.source),
    ownerCount: d.ownerCount,
    owners: d.owners,
    wishlisters: d.wishlisters,
    wishlistedCount: d.wishlistedCount,
    wishlistedByMe: d.wishlistedByMe,
    notificationsMuted,
  };
}
