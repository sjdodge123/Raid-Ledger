/**
 * BullMQ retry delay for the calendar read and write queues that honours a
 * provider's `Retry-After` (Google and Microsoft Graph, read and write).
 *
 * Every retryable calendar failure is rethrown as-is, so the error BullMQ
 * hands the strategy is the provider's `RateLimitError` when it was one. The
 * delay is the exponential step (`base * 2^(attemptsMade-1)`, identical to
 * BullMQ's built-in `exponential`), raised to `retryAfterMs` when that is
 * longer — never sooner than the backoff, and a `Retry-After` is honoured up
 * to `CALENDAR_RETRY_AFTER_MAX_MS` (attempts still count, so it is bounded).
 */
import type { BackoffStrategy, MinimalJob } from 'bullmq';
import { RateLimitError } from './providers/calendar-provider.errors';

/** Custom backoff type: routes the job to `calendarRetryBackoff`. */
export const CALENDAR_RETRY_BACKOFF_TYPE = 'calendar-retry-after';

/** The longest `Retry-After` a single retry waits for. */
export const CALENDAR_RETRY_AFTER_MAX_MS = 60 * 60 * 1000;

/** The job's own `backoff.delay` (the exponential base), or 0. */
function baseDelayMs(job: MinimalJob | undefined): number {
  const backoff = job?.opts.backoff;
  if (typeof backoff === 'number') return backoff;
  return backoff?.delay ?? 0;
}

/**
 * The one definition of a usable `Retry-After` wait: a finite, positive
 * number of ms, clamped to `capMs`. Anything else (absent, NaN, Infinity,
 * zero, negative) is 0, so callers fall back to their own backoff and a
 * provider value can never push a date out of range.
 */
export function validRetryAfterMs(
  wait: number | undefined,
  capMs: number,
): number {
  if (wait === undefined || !Number.isFinite(wait) || wait <= 0) return 0;
  return Math.min(wait, capMs);
}

/** The `Retry-After` wait a rate-limit error asks for, capped; else 0. */
function retryAfterWaitMs(err: Error | undefined): number {
  if (!(err instanceof RateLimitError)) return 0;
  return validRetryAfterMs(err.retryAfterMs, CALENDAR_RETRY_AFTER_MAX_MS);
}

/**
 * Worker `settings.backoffStrategy` for the calendar queues: the exponential
 * step, or the provider's `Retry-After` when that is later.
 */
export const calendarRetryBackoff: BackoffStrategy = (
  attemptsMade: number,
  _type?: string,
  err?: Error,
  job?: MinimalJob,
): number => {
  const step = Math.round(2 ** (attemptsMade - 1) * baseDelayMs(job));
  return Math.max(step, retryAfterWaitMs(err));
};
