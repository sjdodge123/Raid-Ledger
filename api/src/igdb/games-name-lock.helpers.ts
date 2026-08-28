/**
 * Find-then-insert serialization for the `games` table (ROK-1438).
 *
 * Every INSERT-into-`games` path already calls `findGameByNormalizedName`
 * first (ROK-1113), but that guard is a READ followed by a separate WRITE with
 * no database constraint behind it. `games` has UNIQUE on `igdb_id`, `slug`,
 * `itad_game_id` and a partial one on `steam_app_id` — and NOTHING on name. So
 * two concurrent requests for the same title (an ITAD discovery batch
 * overlapping a `/games/lookup-by-name` call, say) both read, both miss, and
 * both insert. Prod 2026-08-28 found 5 such groups, two of them with adjacent
 * ids created seconds apart — the fingerprint of a live race, not old residue.
 *
 * This module closes the window by taking a transaction-scoped advisory lock
 * keyed on the normalized name before the read, so a second racer for the same
 * title blocks until the first commits and then sees its row.
 *
 * ## Why an advisory lock and not a UNIQUE index on the normalized name
 *
 * `CREATE UNIQUE INDEX` fails if any duplicate names still exist when it runs.
 * In the allinone image that failure rolls back the implicit transaction,
 * `docker-entrypoint` exits 1 and supervisor goes FATAL — a near-exact replay
 * of the ROK-1278/1281 outage. Making it safe would mean collapsing the
 * remaining dups inline in SQL first, i.e. re-implementing migration 0140's FK
 * repoint across 23 columns and 19 tables. The index stays on the table as a
 * later hardening once prod is verified clean; it is out of scope here.
 *
 * ## Known tradeoff (documented, not solved)
 *
 * The lock protects the paths that take it. A future insert path that forgets
 * `withGameNameLock` is unprotected — the same discipline the ROK-1113 read
 * guard already relies on. `reference_games_insert_paths.md` is the inventory.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { normalizeForDedup } from './igdb-search-dedup.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Advisory-lock namespace for games-name serialization.
 *
 * Uses the two-argument `pg_advisory_xact_lock(int4, int4)` form, whose
 * keyspace is disjoint from the one-argument `(bigint)` form, so a future
 * advisory-lock user cannot collide with these keys by accident.
 */
export const GAMES_NAME_LOCK_CLASS = 1438;

/**
 * Normalized, de-duplicated, SORTED lock keys for `names`.
 *
 * Sorting is what keeps two overlapping batches from deadlocking: every caller
 * acquires the shared subset of keys in the same order, so no cycle can form.
 * Callers that lock a single name can't deadlock regardless.
 *
 * Names that normalize to empty contribute no key — there is nothing for the
 * ROK-1113 guard to match on, so there is nothing to serialize.
 */
export function buildGameNameLockKeys(
  names: string | readonly string[],
): string[] {
  const list = typeof names === 'string' ? [names] : names;
  const keys = new Set<string>();
  for (const name of list) {
    const normalized = normalizeForDedup(name);
    if (normalized) keys.add(normalized);
  }
  return [...keys].sort();
}

/**
 * Run `fn` with a transaction-scoped advisory lock held on each distinct
 * normalized name in `names`.
 *
 * The callback receives the transaction handle and MUST use it for the
 * find-then-insert — work issued against the outer `db` runs on a different
 * connection and is not covered by the lock.
 *
 * Locks release when the transaction commits or rolls back; there is no
 * unlock path to leak. Batch callers pass the whole name list at once: the
 * largest batch in the codebase is `discoverPopularGames` at 100 names, well
 * inside the shared lock table (`max_locks_per_transaction` × connections).
 *
 * Callbacks that fire on success (e.g. `onGameChanged` taste-vector
 * recomputes) belong AFTER this call returns, not inside `fn` — a rolled-back
 * transaction must not have announced writes that never landed.
 */
export async function withGameNameLock<T>(
  db: Db,
  names: string | readonly string[],
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  const keys = buildGameNameLockKeys(names);
  return db.transaction(async (tx) => {
    for (const key of keys) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${GAMES_NAME_LOCK_CLASS}::int4, hashtext(${key}))`,
      );
    }
    // Drizzle's transaction handle satisfies the same query-builder surface
    // as the top-level db, so callbacks written against `Db` work unchanged.
    return fn(tx);
  });
}
