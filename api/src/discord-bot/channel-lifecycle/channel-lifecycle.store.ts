/**
 * ROK-1431 — the reconcile's narrow DB writes (spec ROK-1428 §2.5, D9).
 *
 * Bindings are only ever CREATED through `ChannelBindingsService.bind()`;
 * this file owns the lifecycle state columns, the suppression rows and the
 * single-flight lock shared by the cron, the admin route and the nudge.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { ArchivedOverwrites } from '../../drizzle/schema/channel-bindings';
import type { ChannelLifecycleSuppressionReason } from '../../drizzle/schema/channel-lifecycle-suppressions';

/** The app's Drizzle handle. */
export type LifecycleDb = PostgresJsDatabase<typeof schema>;

/** The lifecycle columns a reconcile writes on a managed binding. */
export interface LifecycleStatePatch {
  lifecycleState?: 'active' | 'archived';
  autoManaged?: boolean;
  archivedAt?: Date | null;
  restoreParentId?: string | null;
  archivedOverwrites?: ArchivedOverwrites | null;
}

/** The slice of a deleted binding row the unbind hook reads. */
export interface UnboundBindingRow {
  guildId: string;
  gameId: number | null;
  autoManaged: boolean;
  recurrenceGroupId: string | null;
  bindingPurpose: string;
}

/** Write lifecycle state columns on one binding (never routing columns). */
export async function setLifecycleState(
  db: LifecycleDb,
  bindingId: string,
  patch: LifecycleStatePatch,
): Promise<void> {
  await db
    .update(schema.channelBindings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.channelBindings.id, bindingId));
}

/**
 * Record that a game's managed channel must not be recreated (D9). An
 * existing row is kept, so a `deleted` written first survives the unbind hook.
 */
export async function insertSuppression(
  db: LifecycleDb,
  row: {
    guildId: string;
    gameId: number;
    reason: ChannelLifecycleSuppressionReason;
  },
): Promise<void> {
  await db
    .insert(schema.channelLifecycleSuppressions)
    .values(row)
    .onConflictDoNothing();
}

/** Clear a game's suppression ("Recreate"); true when a row was removed. */
export async function deleteSuppression(
  db: LifecycleDb,
  guildId: string,
  gameId: number,
): Promise<boolean> {
  const rows = await db
    .delete(schema.channelLifecycleSuppressions)
    .where(
      and(
        eq(schema.channelLifecycleSuppressions.guildId, guildId),
        eq(schema.channelLifecycleSuppressions.gameId, gameId),
      ),
    )
    .returning({ id: schema.channelLifecycleSuppressions.id });
  return rows.length > 0;
}

/**
 * Unbind hook (D9): an admin removing an auto-managed game binding stops the
 * lifecycle managing that game — suppress it with reason `unbound`.
 */
export async function suppressUnboundAutoBindings(
  db: LifecycleDb,
  rows: readonly UnboundBindingRow[],
): Promise<void> {
  for (const row of rows) {
    if (!row.autoManaged || row.gameId === null) continue;
    if (row.recurrenceGroupId !== null) continue;
    if (row.bindingPurpose !== 'game-announcements') continue;
    await insertSuppression(db, {
      guildId: row.guildId,
      gameId: row.gameId,
      reason: 'unbound',
    });
  }
}

/** Outcome of `withReconcileLock`. */
export type LockedRun<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Single-flight (spec §2.3): run `fn` while holding the transaction-scoped
 * `hashtext('channel-lifecycle')` advisory lock; a concurrent caller gets
 * `{acquired: false}` at once. `fn` uses the outer db — the lock is a mutex.
 */
export async function withReconcileLock<T>(
  db: LifecycleDb,
  fn: () => Promise<T>,
): Promise<LockedRun<T>> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('channel-lifecycle')) AS locked`,
    );
    if (rows[0]?.locked !== true) return { acquired: false };
    return { acquired: true, value: await fn() };
  });
}
