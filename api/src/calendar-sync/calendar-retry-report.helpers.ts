/**
 * ROK-2189: which calendar job errors Sentry should not see. A provider
 * TransientError / RateLimitError rethrown on a NON-final BullMQ attempt is
 * expected — BullMQ backs off and retries — so it is marked for `beforeSend`
 * to drop. The final attempt, and every non-provider error (a derive's DB
 * error, an unexpected exception), stay unmarked and still report.
 */
import { markExpectedRetry } from '../sentry/sentry-expected-retry.helpers';
import {
  RateLimitError,
  TransientError,
} from './providers/calendar-provider.errors';
import { isFinalAttempt } from './write/calendar-write-reconcile-persist.helpers';

type AttemptInfo = Parameters<typeof isFinalAttempt>[0];

/** Marks a retry-pending provider error (see the file header); returns `err`. */
export function markRetryPendingProviderError(
  err: unknown,
  job: AttemptInfo,
): unknown {
  if (isFinalAttempt(job)) return err;
  if (err instanceof TransientError || err instanceof RateLimitError) {
    return markExpectedRetry(err);
  }
  return err;
}
