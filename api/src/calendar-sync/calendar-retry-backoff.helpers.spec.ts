/**
 * Tech debt 2026-10-31 (ROK-1597 hardening): calendar-sync retries honour the
 * provider's `Retry-After` (Google and Microsoft Graph, read and write).
 */
import type { MinimalJob } from 'bullmq';
import {
  RateLimitError,
  TransientError,
} from './providers/calendar-provider.errors';
import {
  CALENDAR_RETRY_AFTER_MAX_MS,
  CALENDAR_RETRY_BACKOFF_TYPE,
  calendarRetryBackoff,
} from './calendar-retry-backoff.helpers';
import { CALENDAR_READ_JOB_OPTIONS } from './read/calendar-read.enqueue.helpers';

const MIN = 60_000;

/** A job carrying the read queue's backoff options (base 60 s). */
function jobWithBase(delay: number): MinimalJob {
  const opts = { backoff: { type: CALENDAR_RETRY_BACKOFF_TYPE, delay } };
  return { opts } as unknown as MinimalJob;
}

function next(attemptsMade: number, err: Error, base = MIN): number {
  return Number(
    calendarRetryBackoff(
      attemptsMade,
      CALENDAR_RETRY_BACKOFF_TYPE,
      err,
      jobWithBase(base),
    ),
  );
}

describe('calendarRetryBackoff', () => {
  it('a non-rate-limit failure keeps the exponential schedule', () => {
    expect(next(1, new TransientError())).toBe(MIN);
    expect(next(3, new TransientError())).toBe(4 * MIN);
  });

  it('a 429 with Retry-After 600 s waits 600 s, not the 60 s step', () => {
    expect(next(1, new RateLimitError(10 * MIN))).toBe(10 * MIN);
  });

  it('a Retry-After shorter than the backoff never retries sooner', () => {
    expect(next(3, new RateLimitError(5_000))).toBe(4 * MIN);
  });

  it('a huge Retry-After is capped, but never below the backoff', () => {
    expect(next(1, new RateLimitError(24 * 60 * MIN))).toBe(
      CALENDAR_RETRY_AFTER_MAX_MS,
    );
    const step = 2 ** 9 * MIN;
    expect(next(10, new RateLimitError(24 * 60 * MIN))).toBe(step);
  });

  it('a non-finite Retry-After falls back to the backoff', () => {
    expect(next(2, new RateLimitError(Number.NaN))).toBe(2 * MIN);
  });

  it('honours the job base delay (write queue: 30 s)', () => {
    expect(next(2, new TransientError(), 30_000)).toBe(60_000);
  });

  it('the read queue jobs use the Retry-After-aware backoff', () => {
    expect(CALENDAR_READ_JOB_OPTIONS.backoff).toEqual({
      type: CALENDAR_RETRY_BACKOFF_TYPE,
      delay: MIN,
    });
  });
});
