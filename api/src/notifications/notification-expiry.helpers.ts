import { sql, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

/**
 * TDB:196 / REVIEW-B R5: `running_late` and `event_delayed` notices carry
 * `expiresAt` = the event end known when they were sent. The event can run
 * longer afterwards — Quick Play suppression rolls `extended_until`, or an
 * admin delays/reschedules it — so the sweep must not reap such a notice while
 * its event's effective end (`GREATEST(upper(duration), extended_until)`) is
 * still ahead. Deferring at the sweep covers every later change in one place,
 * with no write on the voice-join hot path or the delay path.
 *
 * `payload->>'eventId'` is regex-guarded before the int cast so a malformed
 * payload can never fail the whole sweep.
 */
export function eventBoundNoticeStillLive(now: Date): SQL {
  const n = schema.notifications;
  const eventId = sql`${n.payload}->>'eventId'`;
  return sql`(${n.type} IN ('running_late', 'event_delayed') AND EXISTS (
    SELECT 1 FROM events ev
    WHERE ev.id = CASE WHEN ${eventId} ~ '^[0-9]{1,9}$' THEN (${eventId})::int END
      AND ev.cancelled_at IS NULL
      AND GREATEST(upper(ev.duration), ev.extended_until) >= ${now.toISOString()}::timestamptz))`;
}
