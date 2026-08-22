/**
 * Running-late grace-window helpers for live no-show detection (ROK-1424).
 *
 * Clicking "Running late" on an event reminder sets `event_signups.running_late_at`
 * (plus an optional `late_minutes` ETA). Before ROK-1424 the live no-show detector
 * never read those columns, so a player who explicitly said "I'm on my way" was
 * still nudged at start+5 and named in the creator's no-show alert at start+15.
 *
 * Semantics: the marker EXTENDS that player's personal grace window on top of the
 * phase offset it would otherwise be judged by — `late_minutes` when the attendee
 * picked an ETA, otherwise DEFAULT_LATE_GRACE_MIN. The window is anchored on the
 * event start (not on the click), so the button can't be used to defer the alert
 * indefinitely by clicking it long after the event began.
 *
 * Worked example (no ETA, so a 15-minute grace):
 *   - Phase 1 nudge  — normally start+5,  deferred to start+20.
 *   - Phase 2 alert  — normally start+15, deferred to start+30.
 * Past that deadline the player is treated as absent again and the escalation
 * fires late rather than not at all (the suppression path deliberately writes no
 * `event_reminders_sent` dedup row, so a later tick can still send it).
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Grace granted (minutes) when a player marks running late without an ETA. */
export const DEFAULT_LATE_GRACE_MIN = 15;

/** Per-user grace minutes, keyed by `event_signups.user_id`. */
export type LateGraceByUserId = Map<number, number>;

/**
 * Load the running-late grace for every signup on an event.
 *
 * Only rows with `running_late_at` set are returned; anonymous Discord signups
 * (`user_id IS NULL`) are skipped because the late marker is user-scoped.
 */
export async function fetchLateGraceByUserId(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<LateGraceByUserId> {
  const rows = await db
    .select({
      userId: schema.eventSignups.userId,
      lateMinutes: schema.eventSignups.lateMinutes,
    })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        isNotNull(schema.eventSignups.runningLateAt),
      ),
    );
  const grace: LateGraceByUserId = new Map();
  for (const row of rows) {
    if (row.userId == null) continue;
    grace.set(row.userId, row.lateMinutes ?? DEFAULT_LATE_GRACE_MIN);
  }
  return grace;
}

/**
 * Resolve the extended deadline (ms since event start) at which a running-late
 * player becomes fair game for the phase firing at `phaseOffsetMs`.
 */
export function lateDeadlineMs(
  phaseOffsetMs: number,
  lateMinutes: number | null | undefined,
): number {
  const minutes =
    typeof lateMinutes === 'number' && lateMinutes > 0
      ? lateMinutes
      : DEFAULT_LATE_GRACE_MIN;
  return phaseOffsetMs + minutes * 60_000;
}

/**
 * True while a signup that is flagged running late is still inside its extended
 * grace window and must NOT be counted absent yet.
 */
export function isSignupWithinLateGrace(
  signup: {
    runningLateAt?: Date | null;
    lateMinutes?: number | null;
  },
  msSinceStart: number,
  phaseOffsetMs: number,
): boolean {
  if (signup.runningLateAt == null) return false;
  return msSinceStart < lateDeadlineMs(phaseOffsetMs, signup.lateMinutes);
}

/**
 * True while `userId` is still inside their extended grace window, using a map
 * loaded by {@link fetchLateGraceByUserId}. Users absent from the map are not
 * running late.
 */
export function isUserWithinLateGrace(
  grace: LateGraceByUserId,
  userId: number,
  msSinceStart: number,
  phaseOffsetMs: number,
): boolean {
  const minutes = grace.get(userId);
  if (minutes === undefined) return false;
  return msSinceStart < lateDeadlineMs(phaseOffsetMs, minutes);
}
