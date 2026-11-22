/**
 * Fresh-signup detection for the reminder cron (ROK-2293). Pure, so the rule
 * is unit-tested without a database.
 */
import { REMINDER_FRESH_SIGNUP_GRACE_MS } from './event-reminder.constants';

/** One active signup row as the reminder pass loads it. */
export interface ReminderSignupRow {
  eventId: number;
  userId: number | null;
  activatedAt: Date;
}

/** Set key for an (event, user) pair. */
export function freshSignupKey(eventId: number, userId: number): string {
  return `${eventId}:${userId}`;
}

/** True when the signup became active less than the grace period before `now`. */
export function isFreshSignup(activatedAt: Date, now: Date): boolean {
  return now.getTime() - activatedAt.getTime() < REMINDER_FRESH_SIGNUP_GRACE_MS;
}

/** Keys of the (event, user) pairs whose signup is still inside the grace period. */
export function collectFreshSignups(
  rows: ReminderSignupRow[],
  now: Date,
): Set<string> {
  const fresh = new Set<string>();
  for (const row of rows) {
    // Legacy mocks/rows without the column are treated as not fresh.
    if (row.userId === null || !(row.activatedAt instanceof Date)) continue;
    if (isFreshSignup(row.activatedAt, now))
      fresh.add(freshSignupKey(row.eventId, row.userId));
  }
  return fresh;
}
