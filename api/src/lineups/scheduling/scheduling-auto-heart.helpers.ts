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

  let suppressedSet = new Set<number>();
  try {
    const suppressionRows = await db
      .select({ userId: schema.gameInterestSuppressions.userId })
      .from(schema.gameInterestSuppressions)
      .where(
        and(
          inArray(schema.gameInterestSuppressions.userId, voterUserIds),
          eq(schema.gameInterestSuppressions.gameId, gameId),
        ),
      );
    suppressedSet = new Set(suppressionRows.map((s) => s.userId));
  } catch {
    // Suppression table may not exist yet — proceed without filtering
  }
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

/**
 * Fire-and-forget auto-heart for a slot's voters (ROK-1610 extraction — same
 * behaviour, moved out of `SchedulingService` for the 300-line file cap).
 * A failure is logged, never thrown: the lock-in already committed.
 *
 * @param db - Drizzle database handle.
 * @param gameId - The game the poll is for.
 * @param voters - The slot's vote rows; deduplicated here.
 * @param logger - Where a failure is reported.
 */
export function fireAutoHeartForVoters(
  db: Db,
  gameId: number,
  voters: { userId: number }[],
  logger: { warn: (message: string) => void },
): void {
  const voterUserIds = [...new Set(voters.map((v) => v.userId))];
  insertPollInterests({ db, gameId, voterUserIds }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Auto-heart poll interests failed: ${msg}`);
  });
}
