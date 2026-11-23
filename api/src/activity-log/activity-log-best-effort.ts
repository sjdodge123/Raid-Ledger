/**
 * Best-effort audit write: an activity-log insert that fails after the
 * change it records already landed must not turn that change into a 500.
 * The failure is logged and sent to Sentry (tagged with the action, so the
 * operator can count dropped audits) and the caller carries on. Awaited, so
 * on the happy path the row exists before the response returns.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { errorStack } from '../common/error-format.helpers';
import type { ActivityLogService } from './activity-log.service';

const logger = new Logger('ActivityLog');

type LogArgs = Parameters<ActivityLogService['log']>;
// No `executor` arg: swallowing a failed INSERT inside a postgres.js
// transaction poisons it, so best-effort writes always use the service's db.
type BestEffortLogArgs = [
  LogArgs[0],
  LogArgs[1],
  LogArgs[2],
  LogArgs[3]?,
  LogArgs[4]?,
];

/** `activityLog.log(...args)`, never rejecting. */
export async function logBestEffort(
  activityLog: Pick<ActivityLogService, 'log'>,
  ...args: BestEffortLogArgs
): Promise<void> {
  try {
    await activityLog.log(...args);
  } catch (err: unknown) {
    const [entityType, entityId, action] = args;
    // Never the metadata: it may carry Discord ids.
    logger.error(
      `Activity log write failed (${action} on ${entityType} ${entityId})`,
      errorStack(err),
    );
    Sentry.captureException(err, { tags: { activityLog: action } });
  }
}
