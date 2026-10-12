/**
 * ROK-1593 — kill-switch self-heal (derive half): what `runCalendarDerive` does
 * so a derive can never re-create synced away days behind the kill-switch
 * purge.
 *
 * 0. `lockUserDerive` — the per-user advisory xact lock. LOCK ORDER RULE:
 *    every path that takes it does so BEFORE any connection
 *    row lock — advisory(user) → own row `FOR UPDATE` → `FOR KEY SHARE` on
 *    all of the user's rows. The read sync takes it ahead of `lockReadable`
 *    (`lockForSync`), so a second sync or a derive job of the same user waits
 *    on the advisory lock before it holds any row and no cycle can form.
 *    `pg_advisory_xact_lock` is re-entrant per session, so the derive taking
 *    it again inside the sync's `afterBlocks` (same tx) is a no-op.
 * 1. `lockUserConnections` — `FOR KEY SHARE` on ALL of the user's connection
 *    rows in id order (the purge locks them `FOR UPDATE` in the same order).
 *    A purge in flight therefore makes the derive wait until it commits; a
 *    derive that got there first makes the purge wait until the derive
 *    commits, and the purge then deletes what the derive wrote.
 * 2. `readCalendarSyncEnabled(tx)` — the kill switch read AFTER those locks
 *    (READ COMMITTED: a fresh snapshot per statement, so a committed purge
 *    is visible). Off → `purgeCalendarAbsences` and no insert at all.
 *
 * Every statement runs on the caller's `tx`. Manual rows are never touched.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { ReadSyncTx } from './calendar-read-sync.helpers';

/**
 * The per-user derive lock (transaction-scoped). Take it before any
 * `calendar_connections` row lock — see the lock order rule above.
 */
export async function lockUserDerive(
  tx: ReadSyncTx,
  userId: number,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('calendar-derive'), ${userId})`,
  );
}

/** `FOR KEY SHARE` on every connection row of `userId`, lowest id first. */
export async function lockUserConnections(
  tx: ReadSyncTx,
  userId: number,
): Promise<void> {
  const c = schema.calendarConnections;
  await tx
    .select({ id: c.id })
    .from(c)
    .where(eq(c.userId, userId))
    .orderBy(asc(c.id))
    .for('key share');
}

/** Delete every synced (`source='calendar'`) absence of `userId`; returns the count. */
export async function purgeCalendarAbsences(
  tx: ReadSyncTx,
  userId: number,
): Promise<number> {
  const a = schema.gameTimeAbsences;
  const deleted = await tx
    .delete(a)
    .where(and(eq(a.userId, userId), eq(a.source, 'calendar')))
    .returning({ id: a.id });
  return deleted.length;
}
