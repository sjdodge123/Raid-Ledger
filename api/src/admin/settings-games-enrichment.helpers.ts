/**
 * IGDB enrichment reset helper for admin settings (ROK-986).
 * Resets a game's enrichment status so the next cron sync retries IGDB lookup.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/**
 * Reset IGDB enrichment status for a game to 'pending' with zero retries.
 * @param db - Database connection
 * @param gameId - Game ID to reset
 * @returns true if the game was found and updated, false otherwise
 */
export async function resetGameEnrichment(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);

  if (rows.length === 0) return false;

  await db
    .update(schema.games)
    .set({
      igdbEnrichmentStatus: 'pending',
      igdbEnrichmentRetryCount: 0,
    })
    .where(eq(schema.games.id, gameId));

  return true;
}
