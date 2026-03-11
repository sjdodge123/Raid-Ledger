import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Playtime update entry for a matched Steam game. */
export interface PlaytimeUpdateEntry {
  gameId: number;
  playtimeForever: number;
  playtime2weeks: number | null;
}

/** Max entries per batch UPDATE to keep query size reasonable. */
const BATCH_SIZE = 200;

/**
 * Batch-update playtime for existing Steam game interests.
 * Uses a single UPDATE ... FROM VALUES per batch instead of N individual queries.
 */
export async function updateExistingPlaytime(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  toUpdate: PlaytimeUpdateEntry[],
): Promise<number> {
  if (toUpdate.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    updated += await updatePlaytimeBatch(db, userId, batch);
  }
  return updated;
}

/** Run a single batch UPDATE ... FROM VALUES for a chunk of entries. */
async function updatePlaytimeBatch(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  batch: PlaytimeUpdateEntry[],
): Promise<number> {
  const gameIds = batch.map((e) => e.gameId);
  const now = new Date();

  // Build a parameterized VALUES list: (game_id, playtime_forever, playtime_2weeks)
  const valueFragments = batch.map(
    (e) =>
      sql`(${e.gameId}::int, ${e.playtimeForever}::int, ${e.playtime2weeks}::int)`,
  );
  const valuesList = sql.join(valueFragments, sql`, `);

  const rows = await db.execute<{ id: number }>(sql`
    UPDATE ${schema.gameInterests} AS gi
    SET
      playtime_forever = v.playtime_forever,
      playtime_2weeks = v.playtime_2weeks,
      last_synced_at = ${now}
    FROM (VALUES ${valuesList}) AS v(game_id, playtime_forever, playtime_2weeks)
    WHERE gi.user_id = ${userId}
      AND gi.game_id = v.game_id
      AND gi.source = 'steam_library'
      AND gi.game_id = ANY(${gameIds}::int[])
    RETURNING gi.id
  `);

  return rows.length;
}
