/**
 * ROK-2206: a lock shared by every jest worker of one integration run.
 *
 * Per-worker DB clones isolate rows, not server-wide state.
 * `pg_stat_statements_reset()` (no args) clears the stats of EVERY database
 * on the server and `CREATE ROLE` is cluster-global, so two files touching
 * them on different workers can wipe each other mid-test. Advisory locks are
 * scoped per database, so the lock is taken on the server's `postgres` DB,
 * which every worker shares, and held for the whole file.
 *
 * A no-op at 1 worker: files already run one at a time there.
 */
import postgres from 'postgres';
import { requestedWorkers, withDatabase } from './integration-worker-dbs';

/** Files that reset `pg_stat_statements` (ROK-1273 / ROK-1333 specs). */
export const PG_STAT_STATEMENTS_LOCK_KEY = 22_061_273;

export interface CrossWorkerLock {
  release: () => Promise<void>;
}

/**
 * Block until this worker holds `key` across all workers; `serverUrl` is any
 * DB URL on the shared server (e.g. `TestApp.connectionString`).
 */
export async function acquireCrossWorkerLock(
  serverUrl: string,
  key: number,
): Promise<CrossWorkerLock> {
  if (requestedWorkers() < 2) return { release: () => Promise.resolve() };
  const conn = postgres(withDatabase(serverUrl, 'postgres'), { max: 1 });
  await conn`SELECT pg_advisory_lock(${key}::bigint)`;
  return {
    release: async () => {
      try {
        await conn`SELECT pg_advisory_unlock(${key}::bigint)`;
      } finally {
        await conn.end({ timeout: 5 });
      }
    },
  };
}
