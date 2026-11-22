/**
 * Fresh-signup rule for the reminder cron (ROK-2293): a member whose signup
 * became active less than REMINDER_FRESH_SIGNUP_GRACE_MS before the pass gets
 * no DM for the window being dispatched (the window is still claimed).
 *
 * Decided inside the dedup claim's own statement, from the CURRENT signup —
 * a cancel + re-signup between the pass's recipient load and the claim
 * re-stamps `activated_at`, and a flag cached at load time would miss it.
 */
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { utcWallClock } from '../drizzle/timestamp-utils';
import { ACTIVE_SIGNUP_STATUSES } from '../lineups/scheduling/active-signup-statuses.constants';
import { REMINDER_FRESH_SIGNUP_GRACE_MS } from './event-reminder.constants';

/** Signups activated after this instant are fresh for a pass running at `now`. */
export function freshSignupCutoff(now: Date): Date {
  return new Date(now.getTime() - REMINDER_FRESH_SIGNUP_GRACE_MS);
}

/**
 * SQL boolean: the user holds an active signup for the event that became
 * active after `cutoff`. `activated_at` is a zone-less UTC column, so the
 * cutoff is compared as the UTC wall clock. A host with no signup is never
 * fresh.
 */
export function activeSignupFreshSince(
  input: { eventId: number; userId: number },
  cutoff: Date,
): SQL<boolean> {
  const s = schema.eventSignups;
  return sql<boolean>`EXISTS (
    SELECT 1 FROM ${s}
    WHERE ${eq(s.eventId, input.eventId)}
      AND ${eq(s.userId, input.userId)}
      AND ${inArray(s.status, [...ACTIVE_SIGNUP_STATUSES])}
      AND ${s.activatedAt} > ${utcWallClock(cutoff)}
  )`;
}
