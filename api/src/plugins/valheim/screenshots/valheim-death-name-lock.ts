/**
 * ROK-1941 (D9): the per-(server, character) lock both death correlation
 * paths take — a death post linking/inferring (SQL A) and a log death
 * merging/inserting (SQL B). Under it each path is ONE statement that
 * cannot violate `valheim_player_deaths_log_uq` or `_media_uq`, so there is
 * no catch-and-retry (a failed statement poisons a postgres.js transaction).
 * ROK-1931's mod writer must take the same lock.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Advisory-lock class (two-`int4` keyspace). Games use 1438 and the hub
 * media byte cap 1942, so the classes never collide.
 */
export const VALHEIM_DEATH_LOCK_CLASS = 1941;

/** D7 default: a death post matches a recorded death within ±120 s. */
export const DEFAULT_DEATH_POST_WINDOW_SEC = 120;

/** D7: `VALHEIM_DEATH_POST_WINDOW_SEC`, read per call (positive int). */
export function deathPostWindowSec(): number {
  const raw = Number(process.env.VALHEIM_DEATH_POST_WINDOW_SEC);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DEATH_POST_WINDOW_SEC;
}

/**
 * Run `fn` in a transaction holding the death lock for
 * `(pelicanServerId, lower(characterName))`. `fn` MUST use the `tx` it is
 * handed and issue only the one correlation statement (plus the log
 * path's `attribute()` follow-up). Fire success side effects (logs,
 * events) after this returns, never inside it.
 */
export async function withDeathNameLock<T>(
  db: Db,
  pelicanServerId: number,
  characterName: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${VALHEIM_DEATH_LOCK_CLASS}::int4, hashtext(${String(pelicanServerId)} || ':' || lower(${characterName})))`,
    );
    return fn(tx);
  });
}
