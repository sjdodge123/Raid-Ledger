/**
 * 504 review MAJOR 13 — a deadline for the uploads `tar`. Archives run one at
 * a time (backup-uploads.tracker.ts), so a hung tar would stall every later
 * archive, 409 every manual Create and park the nightly cron before its
 * rotations — silently, until the disk filled. After
 * `UPLOADS_TAR_TIMEOUT_MS` the child is SIGKILLed and the archive fails as
 * `timeout`; after `UPLOADS_TAR_SLOW_WARN_MS` Sentry gets one warning.
 */
import * as Sentry from '@sentry/nestjs';

/** Hard stop for one tar run: generous for a multi-GB tree on a Synology NAS. */
export const UPLOADS_TAR_TIMEOUT_MS = 3 * 60 * 60 * 1000;
/** One Sentry warning when a tar is still running after this long. */
export const UPLOADS_TAR_SLOW_WARN_MS = 30 * 60 * 1000;

/** Passed to the tar runner: `execFile` kills the child with `killSignal` on abort. */
export interface TarRunOptions {
  signal: AbortSignal;
  killSignal: 'SIGKILL';
}

export interface TarDeadline {
  timeoutMs?: number | undefined;
  slowWarnMs?: number | undefined;
}

/** The tar outlived its deadline and was killed. */
export class TarTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`tar killed after ${Math.round(timeoutMs / 60_000)} min (timeout)`);
    this.name = 'TarTimeoutError';
  }
}

function warnSlow(slowWarnMs: number, label: string): void {
  const minutes = Math.round(slowWarnMs / 60_000);
  Sentry.captureMessage(
    `uploads archive still running after ${minutes} min (${label})`,
    'warning',
  );
}

/**
 * Run `run` under the deadline. On expiry the signal aborts (execFile then
 * SIGKILLs tar) and the returned promise rejects with `TarTimeoutError` even
 * if the runner ignores the signal. Both timers are cleared on settle.
 */
export function runWithDeadline(
  run: (opts: TarRunOptions) => Promise<unknown>,
  label: string,
  deadline: TarDeadline = {},
): Promise<unknown> {
  const timeoutMs = deadline.timeoutMs ?? UPLOADS_TAR_TIMEOUT_MS;
  const slowWarnMs = deadline.slowWarnMs ?? UPLOADS_TAR_SLOW_WARN_MS;
  const controller = new AbortController();
  let expire: (err: TarTimeoutError) => void = () => undefined;
  const expired = new Promise<never>((_, reject) => {
    expire = reject;
  });
  const killTimer = setTimeout(() => {
    controller.abort();
    expire(new TarTimeoutError(timeoutMs));
  }, timeoutMs);
  const slowTimer = setTimeout(() => warnSlow(slowWarnMs, label), slowWarnMs);
  const child = run({ signal: controller.signal, killSignal: 'SIGKILL' });
  return Promise.race([child, expired])
    .catch((err: unknown) => {
      // execFile rejects with its own AbortError first; report it as the timeout.
      throw controller.signal.aborted ? new TarTimeoutError(timeoutMs) : err;
    })
    .finally(() => {
      clearTimeout(killTimer);
      clearTimeout(slowTimer);
    });
}
