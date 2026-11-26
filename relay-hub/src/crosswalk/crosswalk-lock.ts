import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { HUB_DB, type HubDb } from '../drizzle/drizzle.module';
import { CrosswalkTxStore, type CrosswalkStore } from './crosswalk.repository';
import type { HubTx } from './hub-tx';

/** Advisory-lock class for crosswalk matching (L1). */
export const HUB_CROSSWALK_LOCK_CLASS = 1673;

/** The slice of a transaction the lock needs. */
export interface LockableTx {
  execute(query: SQL): PromiseLike<unknown>;
}

/** The slice of a database the lock needs. */
export interface LockableDb<Tx extends LockableTx> {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * One transaction holding `pg_advisory_xact_lock(1673, hashtext(key))` for
 * every key, taken in sorted order so overlapping batches cannot deadlock.
 */
export async function withCrosswalkLock<Tx extends LockableTx, T>(
  db: LockableDb<Tx>,
  keys: readonly string[],
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const sorted = [...new Set(keys)].sort();
  return db.transaction(async (tx) => {
    for (const key of sorted) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${HUB_CROSSWALK_LOCK_CLASS}::int, hashtext(${key}::text))`,
      );
    }
    return fn(tx);
  });
}

/** Runs `fn` under the crosswalk lock with a store bound to its transaction. */
@Injectable()
export class CrosswalkLock {
  constructor(@Inject(HUB_DB) private readonly db: HubDb) {}

  run<T>(
    keys: readonly string[],
    fn: (store: CrosswalkStore) => Promise<T>,
  ): Promise<T> {
    return withCrosswalkLock<HubTx, T>(this.db, keys, (tx) =>
      fn(new CrosswalkTxStore(tx)),
    );
  }
}
