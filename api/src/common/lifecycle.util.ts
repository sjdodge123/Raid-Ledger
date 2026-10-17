import { Logger } from '@nestjs/common';

/** Options for controlling retry behaviour in {@link bestEffortInit}. */
export interface BestEffortInitOptions {
  /** Number of retries after the initial attempt (default 0 — no retries). */
  retries?: number;
}

/**
 * Wraps a best-effort onModuleInit callback so that failures are logged
 * but do not crash the NestJS bootstrap.
 *
 * Use this for hooks that warm caches, seed data, or close orphaned sessions --
 * things the app can survive without. Startup-critical hooks (settings,
 * plugin registry, Discord module) should NOT use this; annotate those with
 * `// STARTUP-CRITICAL` instead.
 *
 * @param label   Human-readable name shown in the error log
 * @param logger  NestJS Logger instance from the calling service/module
 * @param fn      Async callback to execute
 * @param options Optional retry configuration
 */
export async function bestEffortInit(
  label: string,
  logger: Logger,
  fn: () => Promise<void>,
  options?: BestEffortInitOptions,
): Promise<void> {
  const maxAttempts = (options?.retries ?? 0) + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err: unknown) {
      if (attempt < maxAttempts) {
        logRetryWarning(logger, label, attempt, maxAttempts, err);
        const delayMs = 1000 * 2 ** (attempt - 1);
        await delay(delayMs);
      } else {
        logFinalError(logger, label, err);
      }
    }
  }
}

/** Log a warning for a non-final retry attempt. */
function logRetryWarning(
  logger: Logger,
  label: string,
  attempt: number,
  maxAttempts: number,
  err: unknown,
): void {
  const delayMs = 1000 * 2 ** (attempt - 1);
  const msg = err instanceof Error ? err.message : String(err);
  logger.warn(
    `[bestEffortInit] ${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`,
    msg,
  );
}

/** Log the final exhaustion error. */
function logFinalError(logger: Logger, label: string, err: unknown): void {
  logger.error(
    `[bestEffortInit] ${label} failed — feature degraded but app continues`,
    err instanceof Error ? err.stack : err,
  );
}

/** Promise-based delay using setTimeout (compatible with fake timers). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
