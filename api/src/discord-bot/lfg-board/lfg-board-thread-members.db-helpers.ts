/**
 * ROK-1541 — the two reads the thread-membership listener makes.
 */
import { inArray } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { listGroupMembers, type LfgDb } from '../../lfg/lfg-query.helpers';

/**
 * The live group's user ids — the same read the board's roster renders from.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose group to read.
 * @returns User ids holding a live intent on the game.
 */
export async function readRosterUserIds(
  db: LfgDb,
  gameId: number,
): Promise<Set<number>> {
  const rows = await listGroupMembers(db, gameId);
  return new Set(rows.map((row) => row.userId));
}

/**
 * The stored Discord ids of a set of users (unfiltered — see `linkedDiscordIds`).
 *
 * @param db - Drizzle handle.
 * @param userIds - Users to look up.
 * @returns One `{ discordId }` per user found.
 */
export async function loadDiscordIds(
  db: LfgDb,
  userIds: readonly number[],
): Promise<{ discordId: string | null }[]> {
  if (userIds.length === 0) return [];
  return db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(inArray(schema.users.id, [...userIds]));
}
