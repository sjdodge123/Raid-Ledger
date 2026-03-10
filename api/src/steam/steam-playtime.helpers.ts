import { eq, inArray, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Playtime update entry for a matched Steam game. */
export interface PlaytimeUpdateEntry {
  gameId: number;
  playtimeForever: number;
  playtime2weeks: number | null;
}

/**
 * Batch-update playtime for existing Steam game interests.
 * Uses individual updates to avoid sql.raw() injection risks.
 */
export async function updateExistingPlaytime(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  toUpdate: PlaytimeUpdateEntry[],
): Promise<number> {
  if (toUpdate.length === 0) return 0;
  let updated = 0;
  for (const entry of toUpdate) {
    const result = await db
      .update(schema.gameInterests)
      .set({
        playtimeForever: entry.playtimeForever,
        playtime2weeks: entry.playtime2weeks,
        lastSyncedAt: new Date(),
      })
      .where(
        and(
          eq(schema.gameInterests.userId, userId),
          eq(schema.gameInterests.gameId, entry.gameId),
          eq(schema.gameInterests.source, 'steam_library'),
        ),
      )
      .returning({ id: schema.gameInterests.id });
    updated += result.length;
  }
  return updated;
}
