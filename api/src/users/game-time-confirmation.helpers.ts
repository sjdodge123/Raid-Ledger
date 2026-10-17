/**
 * Game-time confirmation timestamp helpers (ROK-999, extracted ROK-1564).
 *
 * `users.game_time_confirmed_at` answers "is this schedule still true?".
 * Template saves, absence saves and the confirm-only endpoint all stamp it;
 * the composite view and the scheduling-poll heatmap read it.
 */
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Stamp `game_time_confirmed_at` for a user; returns the stamped instant. */
export async function stampGameTimeConfirmedAt(
  db: Db,
  userId: number,
  at: Date = new Date(),
): Promise<Date> {
  await db
    .update(schema.users)
    .set({ gameTimeConfirmedAt: at })
    .where(eq(schema.users.id, userId));
  return at;
}

/** Read `game_time_confirmed_at` for a user; null when never confirmed. */
export async function fetchGameTimeConfirmedAt(
  db: Db,
  userId: number,
): Promise<Date | null> {
  const [row] = await db
    .select({ gameTimeConfirmedAt: schema.users.gameTimeConfirmedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return row?.gameTimeConfirmedAt ?? null;
}
