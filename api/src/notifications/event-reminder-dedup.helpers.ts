import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { ACTIVE_SIGNUP_STATUSES } from '../lineups/scheduling/active-signup-statuses.constants';

/** Input for claiming one reminder dedup slot. */
export interface ReminderDedupClaim {
  eventId: number;
  userId: number;
  windowType: string;
  /** Event start the reminder pass loaded (and will print in the DM). */
  startTime: Date;
}

/**
 * Claims the (event, user, window) reminder dedup row — returns true only for
 * the first claim AND only while the event still starts at `startTime`
 * (ROK-2042). A pass that loaded the event before a delay/reschedule claims
 * nothing, so it neither sends stale-time text nor consumes the re-armed
 * window; the next pass sends with the new start.
 *
 * One statement, no retry. `duration` is a `tsrange` holding UTC wall time
 * (written via `toISOString()`), so the loaded JS Date is converted to a UTC
 * `timestamp` (independent of the session TimeZone) and the stored start is
 * truncated to milliseconds — the precision of the JS Date it was read into.
 *
 * The claim also re-checks the recipient (ROK-2293): it succeeds only while
 * the user still holds an active signup (`ACTIVE_SIGNUP_STATUSES`) for the
 * event or is its host, so a cancel that lands between the pass's recipient
 * query and this claim stops the DM.
 *
 * `FOR SHARE` closes the overlap with a delay: a claim that meets the delay's
 * uncommitted UPDATE waits for it, then re-checks the new start (and refuses);
 * a claim that locks first commits before the UPDATE, so the delay's dedup
 * DELETE that follows removes it and the window re-arms.
 */
export async function claimReminderDedup(
  db: PostgresJsDatabase<typeof schema>,
  input: ReminderDedupClaim,
): Promise<boolean> {
  const loadedStart = input.startTime.toISOString();
  const rows = await db.execute(sql`
    INSERT INTO ${schema.eventRemindersSent} (event_id, user_id, reminder_type)
    SELECT ${input.eventId}::int, ${input.userId}::int, ${input.windowType}::varchar
    WHERE EXISTS (
      SELECT 1 FROM ${schema.events}
      WHERE ${schema.events.id} = ${input.eventId}::int
        AND date_trunc('milliseconds', lower(${schema.events.duration}))
          = (${loadedStart}::timestamptz AT TIME ZONE 'UTC')
        AND ${recipientStillDue(input)}
      FOR SHARE
    )
    ON CONFLICT (event_id, user_id, reminder_type) DO NOTHING
    RETURNING id
  `);
  return rows.length > 0;
}

/**
 * SQL predicate (inside the claim's `events` subquery): the user is the
 * event's host, or still has an active signup for it (ROK-2293).
 */
export function recipientStillDue(
  input: Pick<ReminderDedupClaim, 'eventId' | 'userId'>,
): SQL {
  const s = schema.eventSignups;
  return sql`(${schema.events.creatorId} = ${input.userId}::int OR EXISTS (
    SELECT 1 FROM ${s}
    WHERE ${eq(s.eventId, input.eventId)}
      AND ${eq(s.userId, input.userId)}
      AND ${inArray(s.status, [...ACTIVE_SIGNUP_STATUSES])}
  ))`;
}
