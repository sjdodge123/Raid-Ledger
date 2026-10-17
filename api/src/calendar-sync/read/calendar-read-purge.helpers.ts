/**
 * ROK-1593 D-R7 / D10 / D7: request-path and cron deletes of busy blocks.
 *
 * - Disconnect: the connection's blocks AND its synced (`source='calendar'`)
 *   absences go in the request (§6.4.4), even though the row itself is
 *   deleted later by the `disconnect` job (whose FK cascade would be too late).
 * - Kill switch off: every block and every synced absence goes at once —
 *   busy hours and away days stop counting (operator Q12 ruling, D10).
 *   Manual absences are never touched.
 * - Cron: blocks that ended before any read window can start are pruned.
 *   The window starts at local midnight today, which is never more than
 *   24 h ago, so `ends_at < now − 24 h` only removes blocks no sync will
 *   ever rewrite or read again. Ignored days (`calendar_ignored_days`)
 *   before UTC yesterday go too: a read window starts at local midnight
 *   today, and no zone's "today" is earlier than UTC yesterday (UTC−12), so
 *   such a date can never be derived again.
 *
 * Each returns the distinct user ids touched so the caller can invalidate
 * the game-time cache.
 */
import { and, asc, eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const BUSY_BLOCK_RETENTION_MS = 24 * 60 * 60 * 1000;

const uniqueUsers = (rows: { userId: number }[]) => [
  ...new Set(rows.map((r) => r.userId)),
];

/** Disconnect (D-R7): this connection's blocks. */
export async function purgeConnectionBusyBlocks(
  db: Db | Tx,
  connectionId: number,
): Promise<number[]> {
  const t = schema.calendarBusyBlocks;
  const rows = await db
    .delete(t)
    .where(eq(t.connectionId, connectionId))
    .returning({ userId: t.userId });
  return uniqueUsers(rows);
}

/** Disconnect (D-R7, PR-B): this connection's synced away days. */
export async function purgeConnectionCalendarAbsences(
  db: Db | Tx,
  connectionId: number,
): Promise<number[]> {
  const a = schema.gameTimeAbsences;
  const rows = await db
    .delete(a)
    .where(
      and(eq(a.source, 'calendar'), eq(a.calendarConnectionId, connectionId)),
    )
    .returning({ userId: a.userId });
  return uniqueUsers(rows);
}

/**
 * Kill switch off (D10): every block and every synced absence. Runs AFTER the switch is stored off,
 * and first locks every connection row — the same lock a read sync takes
 * before writing (`runCalendarReadSync`). A sync that already holds a lock
 * commits first and its blocks are deleted here; one that locks later
 * re-checks the switch, sees it off and writes nothing. Rows are locked in
 * `id` order so two purges (or any other multi-row locker that also goes
 * in id order) queue instead of deadlocking.
 */
export async function purgeAllCalendarReadData(db: Db): Promise<number[]> {
  const t = schema.calendarBusyBlocks;
  const c = schema.calendarConnections;
  const a = schema.gameTimeAbsences;
  const rows = await db.transaction(async (tx) => {
    await tx.select({ id: c.id }).from(c).orderBy(asc(c.id)).for('update');
    const blocks = await tx.delete(t).returning({ userId: t.userId });
    const absences = await tx
      .delete(a)
      .where(eq(a.source, 'calendar'))
      .returning({ userId: a.userId });
    return [...blocks, ...absences];
  });
  return uniqueUsers(rows);
}

/** The cutoff below which a block can never be inside a read window. */
export function busyBlockPruneCutoff(now: Date): Date {
  return new Date(now.getTime() - BUSY_BLOCK_RETENTION_MS);
}

/** Cron: blocks that ended before any sync window start. */
export async function pruneEndedBusyBlocks(db: Db, now: Date): Promise<number> {
  const t = schema.calendarBusyBlocks;
  const rows = await db
    .delete(t)
    .where(lt(t.endsAt, busyBlockPruneCutoff(now)))
    .returning({ id: t.id });
  return rows.length;
}

/** UTC yesterday as `YYYY-MM-DD` — the oldest date any read window holds. */
export function ignoredDayPruneCutoff(now: Date): string {
  return new Date(now.getTime() - BUSY_BLOCK_RETENTION_MS)
    .toISOString()
    .slice(0, 10);
}

/** Cron: ignored days no derive can reach any more (header). */
export async function pruneStaleIgnoredDays(
  db: Db,
  now: Date,
): Promise<number> {
  const t = schema.calendarIgnoredDays;
  const rows = await db
    .delete(t)
    .where(lt(t.date, ignoredDayPruneCutoff(now)))
    .returning({ userId: t.userId });
  return rows.length;
}
