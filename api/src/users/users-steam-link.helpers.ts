import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** First `previousSteamId` of a raw `RETURNING` row list, or null. */
function previousOf(result: unknown): string | null {
  if (!Array.isArray(result)) return null;
  const row = (result as { previousSteamId?: string | null }[])[0];
  return row?.previousSteamId ?? null;
}

/**
 * ROK-1835: write `users.steam_id` and return the value it REPLACED, in one
 * statement (the `FOR UPDATE` sub-select reads the row it then overwrites),
 * so a concurrent link/unlink can never announce the wrong old SteamID.
 * Returns null when the user had no link (or does not exist).
 */
export async function setSteamIdReturningPrevious(
  db: Db,
  userId: number,
  steamId: string,
): Promise<string | null> {
  const res = await db.execute(sql`
    UPDATE users SET steam_id = ${steamId}, updated_at = now()
      FROM (SELECT id, steam_id FROM users WHERE id = ${userId} FOR UPDATE) AS old
     WHERE users.id = old.id
 RETURNING old.steam_id AS "previousSteamId"`);
  return previousOf(res);
}

/**
 * ROK-1835: clear `users.steam_id` and return the SteamID it held, in one
 * statement. Null = nothing was linked, nothing was written, nothing to emit.
 */
export async function clearSteamIdReturningPrevious(
  db: Db,
  userId: number,
): Promise<string | null> {
  const res = await db.execute(sql`
    UPDATE users SET steam_id = NULL, updated_at = now()
      FROM (SELECT id, steam_id FROM users
             WHERE id = ${userId} AND steam_id IS NOT NULL FOR UPDATE) AS old
     WHERE users.id = old.id
 RETURNING old.steam_id AS "previousSteamId"`);
  return previousOf(res);
}
