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

/**
 * After `updateStatus` wrote the row: audits the change (ROK-1728 Q6), then
 * starts the displacement check when the new status is tentative (ROK-459).
 */
export async function afterStatusChange(
  activityLog: Pick<ActivityLogService, 'log'>,
  allocation: Pick<SignupsAllocationService, 'checkTentativeDisplacement'>,
  logger: Pick<Logger, 'warn'>,
  row: { id: number; eventId: number; userId: number | null },
  status: UpdateSignupStatusDto['status'],
): Promise<void> {
  await logStatusChange(activityLog, row.eventId, row.userId, status);
  if (status === 'tentative')
    checkTentativeDisplacementLater(allocation, logger, row.eventId, row.id);
}
