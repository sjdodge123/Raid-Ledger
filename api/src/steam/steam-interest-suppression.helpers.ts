/**
 * Steam sync respect for un-hearts (ROK-1796).
 *
 * When a user removes a game from their want-to-play list, `removeInterest`
 * writes a `game_interest_suppressions` row. The daily Steam library and
 * wishlist syncs must not re-insert a `steam_library` / `steam_wishlist` row
 * for that (user, game) pair, or the un-heart silently undoes itself the next
 * morning and the "Based on your interest" DMs come back.
 */
import { and, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Minimal shape of a pending `game_interests` insert row. */
interface UserGamePair {
  userId: number;
  gameId: number;
}

/** Key a (user, game) pair for set lookups. */
function pairKey(p: UserGamePair): string {
  return `${p.userId}:${p.gameId}`;
}

/**
 * Drop every row whose (user, game) pair the user has suppressed.
 *
 * @param db - Database connection
 * @param rows - Pending insert rows
 * @returns The rows that are still allowed to be inserted
 */
export async function dropSuppressedRows<T extends UserGamePair>(
  db: PostgresJsDatabase<typeof schema>,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const t = schema.gameInterestSuppressions;
  const suppressed = await db
    .select({ userId: t.userId, gameId: t.gameId })
    .from(t)
    .where(
      and(
        inArray(t.userId, [...new Set(rows.map((r) => r.userId))]),
        inArray(t.gameId, [...new Set(rows.map((r) => r.gameId))]),
      ),
    );
  if (suppressed.length === 0) return rows;
  const blocked = new Set(suppressed.map(pairKey));
  return rows.filter((r) => !blocked.has(pairKey(r)));
}
