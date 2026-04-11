/**
 * Auto-heart game for poll voters when event is created (ROK-1031).
 * Bulk-inserts game_interests rows with source 'poll' for each voter,
 * respecting suppression rows and using onConflictDoNothing.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Parameters for the poll interest insert helper. */
export interface InsertPollInterestsParams {
  db: Db;
  gameId: number;
  voterUserIds: number[];
}

/**
 * Insert game_interests rows with source 'poll' for each voter.
 * Checks the suppressions table to skip users who explicitly
 * un-hearted the game. Uses onConflictDoNothing to avoid
 * duplicating existing interests.
 * @param params - Insert parameters
 */
export async function insertPollInterests(
  params: InsertPollInterestsParams,
): Promise<void> {
  const { db, gameId, voterUserIds } = params;
  if (voterUserIds.length === 0) return;

  const suppressionRows = await db
    .select({
      userId: schema.gameInterestSuppressions.userId,
      gameId: schema.gameInterestSuppressions.gameId,
    })
    .from(schema.gameInterestSuppressions)
    .where(
      and(
        inArray(schema.gameInterestSuppressions.userId, voterUserIds),
        eq(schema.gameInterestSuppressions.gameId, gameId),
      ),
    );

  const suppressions = Array.isArray(suppressionRows) ? suppressionRows : [];
  const suppressedSet = new Set(suppressions.map((s) => s.userId));
  const eligibleUserIds = voterUserIds.filter((uid) => !suppressedSet.has(uid));

  if (eligibleUserIds.length === 0) {
    return;
  }

  const rows = eligibleUserIds.map((userId) => ({
    userId,
    gameId,
    source: 'poll' as const,
  }));

  await db.insert(schema.gameInterests).values(rows).onConflictDoNothing();
}
