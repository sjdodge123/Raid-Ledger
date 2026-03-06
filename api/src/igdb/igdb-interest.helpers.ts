import { and, eq, inArray, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { GameInterestResponseDto } from '@raid-ledger/contract';

/**
 * Get interest count for a game.
 * @param db - Database connection
 * @param gameId - Game ID
 * @returns Interest count
 */
export async function getInterestCount(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.gameInterests)
    .where(eq(schema.gameInterests.gameId, gameId));
  return result?.count ?? 0;
}

/**
 * Get user's interest source for a game.
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
      ),
    )
    .limit(1);
  return row?.source ?? null;
}

/**
 * Fetch first 8 interested players for avatar display (ROK-282).
 * @param db - Database connection
 * @param gameId - Game ID
 * @returns Player preview list
 */
export async function getInterestedPlayers(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
) {
  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      avatar: schema.users.avatar,
      customAvatarUrl: schema.users.customAvatarUrl,
      discordId: schema.users.discordId,
    })
    .from(schema.gameInterests)
    .innerJoin(schema.users, eq(schema.gameInterests.userId, schema.users.id))
    .where(eq(schema.gameInterests.gameId, gameId))
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

/** Fetch batch counts and user interests in parallel. */
async function fetchBatchData(
  db: PostgresJsDatabase<typeof schema>,
  gameIds: number[],
  userId: number,
) {
  return Promise.all([
    db
      .select({
        gameId: schema.gameInterests.gameId,
        count: sql<number>`count(*)::int`.as('count'),
      })
      .from(schema.gameInterests)
      .where(inArray(schema.gameInterests.gameId, gameIds))
      .groupBy(schema.gameInterests.gameId),
    db
      .select({ gameId: schema.gameInterests.gameId })
      .from(schema.gameInterests)
      .where(
        and(
          inArray(schema.gameInterests.gameId, gameIds),
          eq(schema.gameInterests.userId, userId),
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
  await db
    .insert(schema.gameInterests)
    .values({ userId, gameId, source: 'manual' })
    .onConflictDoNothing();

  const [count, players] = await Promise.all([
    getInterestCount(db, gameId),
    getInterestedPlayers(db, gameId),
  ]);
  return { wantToPlay: true, count, players, source: 'manual' as const };
}

/**
 * Remove want-to-play interest (with auto-heart suppression for Discord source).
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
  const source = await getUserInterestSource(db, gameId, userId);

  if (source === 'discord') {
    await db
      .insert(schema.gameInterestSuppressions)
      .values({ userId, gameId })
      .onConflictDoNothing();
  }

  await db
    .delete(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.gameId, gameId),
        eq(schema.gameInterests.userId, userId),
      ),
    );

  const [count, players] = await Promise.all([
    getInterestCount(db, gameId),
    getInterestedPlayers(db, gameId),
  ]);
  return { wantToPlay: false, count, players };
}
