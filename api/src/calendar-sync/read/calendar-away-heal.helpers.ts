/**
 * ROK-1593 PR-B review (MAJOR-1 / MAJOR-2): the self-heal paths that keep
 * synced away days (`game_time_absences.source = 'calendar'`) in line with
 * the connections they came from (operator Q12: kill switch off or a
 * connection that stops counting → its away days stop counting).
 *
 * - Kill switch off: the read cron deletes any synced absence still there
 *   each tick. The admin purge normally removed them already; this catches a
 *   purge that failed or lost a race with an in-flight derive.
 * - A connection that no longer counts (not `active`, or read off) but still
 *   has synced absences attributed to it: the cron queues a derive for its
 *   user (bounded per tick). The derive only reads blocks of
 *   `active AND read_enabled` connections, so it removes or re-attributes
 *   those rows and the user drops out of the next tick's query. Only rows
 *   ending UTC-yesterday or later are matched (review r2 N2): the derive
 *   never touches history, so a past row would re-match every tick forever.
 * - The write side flipped a connection to `needs_reconnect`: a derive is
 *   queued for its user right away (best effort; the cron is the backstop).
 *
 * Manual absences are never touched (every query filters `source`).
 */
import { Logger } from '@nestjs/common';
import { and, eq, gte, isNotNull, ne, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  enqueueCalendarDerive,
  type CalendarReadQueue,
} from './calendar-read.enqueue.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Most users one cron tick re-derives through the stale-absence backstop. */
export const STALE_ABSENCE_DERIVE_LIMIT = 200;

const logger = new Logger('CalendarAwayHeal');

const isSynced = () => {
  const a = schema.gameTimeAbsences;
  // `calendar_connection_id IS NOT NULL` ⇔ `source = 'calendar'` (CHECK);
  // stating both lets the planner use the connection-id index.
  return and(eq(a.source, 'calendar'), isNotNull(a.calendarConnectionId));
};

/** Kill switch off: every synced absence still stored. Returns user ids. */
export async function purgeStrayCalendarAbsences(db: Db): Promise<number[]> {
  const a = schema.gameTimeAbsences;
  const rows = await db
    .delete(a)
    .where(isSynced())
    .returning({ userId: a.userId });
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * `YYYY-MM-DD` of the UTC day before `now`. No zone's local today is earlier
 * than this, so every row the derive can still touch ends on or after it.
 */
export function utcYesterday(now: Date): string {
  const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}

/**
 * Users with synced absences attributed to a connection that stopped
 * counting, among rows the derive can still touch (ending UTC-yesterday or
 * later — N2). Past-only rows never re-trigger a derive.
 */
export async function findUsersWithStaleCalendarAbsences(
  db: Db,
  now: Date = new Date(),
  limit: number = STALE_ABSENCE_DERIVE_LIMIT,
): Promise<number[]> {
  const a = schema.gameTimeAbsences;
  const c = schema.calendarConnections;
  const stopped = or(ne(c.status, 'active'), eq(c.readEnabled, false));
  const current = gte(a.endDate, utcYesterday(now));
  const rows = await db
    .selectDistinct({ userId: a.userId })
    .from(a)
    .innerJoin(c, eq(c.id, a.calendarConnectionId))
    .where(and(isSynced(), stopped, current))
    .orderBy(a.userId)
    .limit(limit);
  return rows.map((r) => r.userId);
}

/** Queue a derive per user; a failed enqueue is logged and skipped. */
export async function enqueueDerivesBestEffort(
  queue: CalendarReadQueue,
  userIds: readonly number[],
  reason: string,
): Promise<void> {
  for (const userId of userIds) {
    try {
      await enqueueCalendarDerive(queue, userId);
    } catch (err) {
      const name = err instanceof Error ? err.name : 'unknown';
      logger.warn(`derive enqueue (${reason}) failed (${name})`);
    }
  }
}

/**
 * MAJOR-2 (b): after a write job reports `failed`, queue a derive when the
 * connection is now `needs_reconnect` (its blocks stopped counting). Never
 * throws.
 */
export async function deriveIfNeedsReconnect(
  db: Db,
  queue: CalendarReadQueue,
  connectionId: number,
): Promise<void> {
  const c = schema.calendarConnections;
  try {
    const [row] = await db
      .select({ userId: c.userId })
      .from(c)
      .where(and(eq(c.id, connectionId), eq(c.status, 'needs_reconnect')))
      .limit(1);
    if (row) await enqueueDerivesBestEffort(queue, [row.userId], 'reconnect');
  } catch (err) {
    // Best effort: the cron's stale-absence backstop re-queues it.
    const name = err instanceof Error ? err.name : 'unknown';
    logger.warn(`needs_reconnect derive check failed (${name})`);
  }
}
