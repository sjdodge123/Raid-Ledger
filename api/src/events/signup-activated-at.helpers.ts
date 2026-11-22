/**
 * `event_signups.activated_at` writes (ROK-2293). The column records when a
 * signup last became active, so the reminder cron can skip a window for
 * someone who only just signed up. Insert covers it via the column default;
 * every UPDATE that can move a row into an active status uses these helpers.
 * `signed_up_at` is never touched — roster/bench order sorts by it.
 */
import { inArray, sql, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { INACTIVE_SIGNUP_STATUSES } from './signup-status.constants';

/**
 * SET expression: `now()` when the row's CURRENT (pre-update) status is
 * inactive, otherwise the existing value — Postgres evaluates SET expressions
 * against the old row, so a tentative ↔ signed_up change keeps its clock.
 */
export function activatedAtOnReactivation(): SQL {
  const s = schema.eventSignups;
  return sql`CASE WHEN ${inArray(s.status, [...INACTIVE_SIGNUP_STATUSES])} THEN now() ELSE ${s.activatedAt} END`;
}

/** True for a status that holds a place on the event. */
export function isActiveSignupStatus(status: string): boolean {
  return !(INACTIVE_SIGNUP_STATUSES as readonly string[]).includes(status);
}

/**
 * Patch fragment for a write that sets `status`: re-stamps `activated_at` on
 * an inactive → active flip, and is empty when the new status is inactive.
 */
export function activatedAtPatch(status: string): { activatedAt?: SQL } {
  return isActiveSignupStatus(status)
    ? { activatedAt: activatedAtOnReactivation() }
    : {};
}
