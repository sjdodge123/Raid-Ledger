/**
 * Deadlock retry for the integration reset (`truncateAllTables`).
 *
 * drizzle-orm 0.45 wraps every driver error in `DrizzleQueryError` and keeps
 * the Postgres error on `.cause` (`drizzle-orm/pg-core/session.js`), so the
 * SQLSTATE has to be read from the error OR its cause. Before ROK-2196 the
 * check looked at the top-level `code` only and the retry never fired.
 */

/** Postgres SQLSTATE for `deadlock_detected`. */
export const PG_DEADLOCK_CODE = '40P01';

export interface DeadlockRetryOptions {
  /** Total attempts, including the first. */
  maxRetries?: number;
  /** First back-off delay; doubles per attempt. */
  baseDelayMs?: number;
}

/** Read a string `code` property off an unknown value, if it has one. */
function codeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('code' in value)) return undefined;
  return typeof value.code === 'string' ? value.code : undefined;
}

/**
 * True when `err` is a Postgres deadlock — either the driver error itself or
 * a wrapper (e.g. `DrizzleQueryError`) carrying it on `.cause`.
 */
export function isDeadlockError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (codeOf(err) ?? codeOf(err.cause)) === PG_DEADLOCK_CODE;
}

/**
 * Run `fn`, retrying with exponential back-off while it fails with a
 * Postgres deadlock. Any other error, or the last deadlock, is rethrown.
 */
export async function retryOnDeadlock(
  fn: () => Promise<unknown>,
  { maxRetries = 5, baseDelayMs = 200 }: DeadlockRetryOptions = {},
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fn();
      return;
    } catch (err: unknown) {
      if (!isDeadlockError(err) || attempt === maxRetries) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
