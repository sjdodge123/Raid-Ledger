import { eq, inArray, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Playtime update entry for a matched Steam game. */
export interface PlaytimeUpdateEntry {
  gameId: number;
  playtimeForever: number;
  playtime2weeks: number | null;
}

/** Build SQL CASE expressions for batch playtime update. */
function buildPlaytimeCases(toUpdate: PlaytimeUpdateEntry[]) {
  const foreverCases = toUpdate
    .map((u) => `WHEN game_id = ${u.gameId} THEN ${u.playtimeForever}`)
    .join(' ');
  const weeksCases = toUpdate
    .map(
      (u) =>
        `WHEN game_id = ${u.gameId} THEN ${u.playtime2weeks === null ? 'NULL' : u.playtime2weeks}`,
    )
    .join(' ');
  return { foreverCases, weeksCases };
}

/** Build the SET clause for batch playtime updates. */
function buildPlaytimeSetClause(toUpdate: PlaytimeUpdateEntry[]) {
  const { foreverCases, weeksCases } = buildPlaytimeCases(toUpdate);
  return {
    playtimeForever: sql.raw(`CASE ${foreverCases} ELSE playtime_forever END`),
    playtime2weeks: sql.raw(`CASE ${weeksCases} ELSE playtime_2weeks END`),
    lastSyncedAt: new Date(),
  };
}

/**
 * Batch-update playtime for existing Steam game interests.
 * @param db - Database connection
 * @param userId - User ID to update interests for
 * @param toUpdate - Array of playtime update entries
 * @returns Number of rows updated
 */
export async function updateExistingPlaytime(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  toUpdate: PlaytimeUpdateEntry[],
): Promise<number> {
  if (toUpdate.length === 0) return 0;
  const result = await db
    .update(schema.gameInterests)
    .set(buildPlaytimeSetClause(toUpdate))
    .where(
      and(
        eq(schema.gameInterests.userId, userId),
        inArray(
          schema.gameInterests.gameId,
          toUpdate.map((u) => u.gameId),
        ),
        eq(schema.gameInterests.source, 'steam_library'),
      ),
    )
    .returning({ id: schema.gameInterests.id });
  return result.length;
}
