import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';

/** The caller's transaction every hook runs on (never a separate one). */
export type UserLifecycleTx = PostgresJsDatabase<typeof schema>;

/** A character row as the core delete returned it (core columns only). */
export interface DeletedCharacterRow {
  addonGuid: string | null;
  gameId: number;
  region: string | null;
}

/** Phase two of a user wipe: runs AFTER the user's rows are deleted. */
export type UserWipeFinisher = (tx: UserLifecycleTx) => Promise<void>;

/**
 * ROK-2364 — what a plugin does when core changes a user's lifecycle. Every
 * hook is optional and runs sequentially on the caller's tx with no catch: a
 * throw aborts that tx exactly as an inline call would (postgres.js poisons
 * the whole tx on a failed statement, so there is no partial recovery).
 */
export interface UserLifecycleHooks {
  /**
   * Phase one of a user wipe, BEFORE the user's rows are deleted (read what
   * is about to go); the returned finisher runs after the delete.
   */
  prepareWipe?(tx: UserLifecycleTx, userId: number): Promise<UserWipeFinisher>;
  /** After one character row was deleted, in the same tx. */
  onCharacterDeleted?(
    tx: UserLifecycleTx,
    row: DeletedCharacterRow,
    actorUserId: number,
  ): Promise<void>;
  /** After `deactivated_at` was set (same tx). */
  onUserDeactivated?(
    tx: UserLifecycleTx,
    userId: number,
    actorId: number | null,
  ): Promise<void>;
  /**
   * After `deactivated_at` was cleared (same tx), with the value it had as
   * Postgres text (`lockDeactivatedAt`). @returns audits written.
   */
  onUserReactivated?(
    tx: UserLifecycleTx,
    userId: number,
    deactivatedAt: string,
    actorId: number | null,
  ): Promise<number>;
}
