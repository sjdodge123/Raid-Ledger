/**
 * Audit writes for event mutations that have already landed (cancel,
 * reschedule, roster reconfirm). Best-effort: a failed activity-log insert
 * is logged + sent to Sentry and never turns the finished change into a 500.
 */
import { logBestEffort } from '../activity-log/activity-log-best-effort';
import type { ActivityLogService } from '../activity-log/activity-log.service';

type ActivityLog = Pick<ActivityLogService, 'log'>;

/** `event_cancelled` audit row for a cancel that already committed. */
export function auditEventCancelled(
  activityLog: ActivityLog,
  eventId: number,
  userId: number,
  reason: string | null,
): Promise<void> {
  const meta = { reason };
  return logBestEffort(
    activityLog,
    'event',
    eventId,
    'event_cancelled',
    userId,
    meta,
  );
}

/** `event_rescheduled` audit row for a reschedule that already committed. */
export function auditEventRescheduled(
  activityLog: ActivityLog,
  eventId: number,
  userId: number,
  oldStart: string,
  newStart: string,
): Promise<void> {
  const meta = { oldStart, newStart };
  return logBestEffort(
    activityLog,
    'event',
    eventId,
    'event_rescheduled',
    userId,
    meta,
  );
}

/**
 * ROK-1269: one `signup_reconfirmed` row per attendee whose pending status
 * flipped to confirmed via a roster update (actor = the attendee).
 */
export async function auditRosterReconfirms(
  activityLog: ActivityLog,
  eventId: number,
  userIds: number[],
): Promise<void> {
  const meta = { reason: 'roster-update' };
  for (const uid of userIds) {
    await logBestEffort(
      activityLog,
      'event',
      eventId,
      'signup_reconfirmed',
      uid,
      meta,
    );
  }
}
