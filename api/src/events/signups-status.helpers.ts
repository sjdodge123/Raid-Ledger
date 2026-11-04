/**
 * Side effects of `SignupsService.updateStatus`, kept out of the service to
 * hold it under the file-size limit.
 */
import type { Logger } from '@nestjs/common';
import type { UpdateSignupStatusDto } from '@raid-ledger/contract';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type { SignupsAllocationService } from './signups-allocation.service';

/**
 * Audits an in-place status change. ROK-1728 Q6: a series re-join reads it
 * as the user's own decision on that night, so the night is not revived.
 */
export async function logStatusChange(
  activityLog: Pick<ActivityLogService, 'log'>,
  eventId: number,
  userId: number | null,
  status: UpdateSignupStatusDto['status'],
): Promise<void> {
  await activityLog.log('event', eventId, 'signup_status_changed', userId, {
    status,
  });
}

/** ROK-459: fire-and-forget bench displacement check after a tentative. */
export function checkTentativeDisplacementLater(
  allocation: Pick<SignupsAllocationService, 'checkTentativeDisplacement'>,
  logger: Pick<Logger, 'warn'>,
  eventId: number,
  signupId: number,
): void {
  allocation
    .checkTentativeDisplacement(eventId, signupId)
    .catch((err: unknown) => {
      logger.warn(
        `ROK-459: Failed tentative displacement check: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    });
}

/** Caller options for `SignupsService.updateStatus`. */
export interface StatusChangeOptions {
  /**
   * `false` skips the `signup_status_changed` row. Only for a flow that called
   * `signup()` for the same row a moment earlier (Discord "sign up as
   * tentative"): that call already audited it (`signup_added`, or the
   * reactivation row), so the re-join rule still sees the night as touched and
   * the feed shows one row per click (ROK-1728 review MINOR 3).
   */
  audit?: boolean;
}

/** The status written plus the caller's options. */
export interface StatusChange extends StatusChangeOptions {
  status: UpdateSignupStatusDto['status'];
}

/**
 * After `updateStatus` wrote the row: audits the change (ROK-1728 Q6) unless
 * the caller opted out, then starts the displacement check when the new
 * status is tentative (ROK-459).
 */
export async function afterStatusChange(
  activityLog: Pick<ActivityLogService, 'log'>,
  allocation: Pick<SignupsAllocationService, 'checkTentativeDisplacement'>,
  logger: Pick<Logger, 'warn' | 'log'>,
  row: { id: number; eventId: number; userId: number | null },
  change: StatusChange,
): Promise<void> {
  const { status } = change;
  logger.log(
    `Signup ${row.id} status updated to ${status} for event ${row.eventId}`,
  );
  if (change.audit !== false)
    await logStatusChange(activityLog, row.eventId, row.userId, status);
  if (status === 'tentative')
    checkTentativeDisplacementLater(allocation, logger, row.eventId, row.id);
}
