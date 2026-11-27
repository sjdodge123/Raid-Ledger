import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/**
 * The user's `deactivated_at`, row-locked, as Postgres text; undefined = no
 * such user. Text, not a JS Date: the column is a naive `timestamp` written by
 * `NOW()` in the session time zone, and is compared to timestamptz grants in
 * SQL with the same session cast (ROK-2160 review r2 M2) — a JS round-trip
 * reads it as UTC and is wrong whenever the session time zone is not UTC.
 * Core since ROK-2364 (it touches only `users`).
 */
export async function lockDeactivatedAt(
  tx: PostgresJsDatabase<typeof schema>,
  userId: number,
): Promise<string | null | undefined> {
  const [row] = await tx
    .select({ at: sql<string | null>`${schema.users.deactivatedAt}::text` })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .for('update');
  return row ? row.at : undefined;
}
