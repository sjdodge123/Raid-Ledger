/**
 * ROK-1593 D-R7 / D10 / D7: request-path and cron deletes of busy blocks.
 *
 * - Disconnect: the connection's blocks go in the request (§6.4.4), even
 *   though the row itself is deleted later by the `disconnect` job.
 * - Kill switch off: every block goes at once — busy hours stop counting
 *   (operator Q12 ruling). PR-B adds the `source='calendar'` absences here.
 * - Cron: blocks that ended before any read window can start are pruned.
 *   The window starts at local midnight today, which is never more than
 *   24 h ago, so `ends_at < now − 24 h` only removes blocks no sync will
 *   ever rewrite or read again.
 *
 * Each returns the distinct user ids touched so the caller can invalidate
 * the game-time cache.
 */
import { eq, lt } from 'drizzle-orm';
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

/**
 * Kill switch off (D10): every block. Runs AFTER the switch is stored off,
 * and first locks every connection row — the same lock a read sync takes
 * before writing (`runCalendarReadSync`). A sync that already holds a lock
 * commits first and its blocks are deleted here; one that locks later
 * re-checks the switch, sees it off and writes nothing.
 */
export async function purgeAllBusyBlocks(db: Db): Promise<number[]> {
  const t = schema.calendarBusyBlocks;
  const c = schema.calendarConnections;
  const rows = await db.transaction(async (tx) => {
    await tx.select({ id: c.id }).from(c).for('update');
    return tx.delete(t).returning({ userId: t.userId });
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
