/**
 * ROK-1727: in-process serial queue for Wowhead requests — one task at a time,
 * starts spaced ≥ `minIntervalMs` apart (operator Q2: ≤1 req/s), plus the
 * pure backoff schedule the service applies on 429 / 5xx / network errors.
 */

export const WOWHEAD_MIN_INTERVAL_MS = 1000;
/** Tries per item per run before the row is stored as `error`. */
export const WOWHEAD_MAX_TRIES_PER_RUN = 3;

const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;

export interface WowheadLimiterOptions {
  minIntervalMs?: number;
  /** Clock — injectable for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Delay — injectable for tests; defaults to a `setTimeout` promise. */
  wait?: (ms: number) => Promise<void>;
}

export interface WowheadLimiter {
  /** Run `task` after every earlier task has settled and the interval passed. */
  schedule<T>(task: () => Promise<T>): Promise<T>;
  /** Tasks queued or running. */
  pending(): number;
}

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createWowheadLimiter(
  opts: WowheadLimiterOptions = {},
): WowheadLimiter {
  const minIntervalMs = opts.minIntervalMs ?? WOWHEAD_MIN_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const wait = opts.wait ?? defaultWait;
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart: number | null = null;
  let inFlight = 0;

  const run = async <T>(task: () => Promise<T>): Promise<T> => {
    if (lastStart !== null) {
      const gap = lastStart + minIntervalMs - now();
      if (gap > 0) await wait(gap);
    }
    lastStart = now();
    return task();
  };

  return {
    schedule<T>(task: () => Promise<T>): Promise<T> {
      inFlight += 1;
      const result = tail.then(() => run(task));
      const settled = result.finally(() => {
        inFlight -= 1;
      });
      tail = settled.catch(() => undefined);
      return result;
    },
    pending: () => inFlight,
  };
}

/** In-run retry delay after `attempts` failures: min(60 s, 2^attempts s). */
export function retryDelayMs(attempts: number): number {
  return Math.min(60 * SECOND_MS, 2 ** attempts * SECOND_MS);
}

/** `next_retry_at` offset for an `error` row: min(24 h, 2^attempts h). */
export function errorRetryOffsetMs(attempts: number): number {
  return Math.min(24 * HOUR_MS, 2 ** attempts * HOUR_MS);
}
