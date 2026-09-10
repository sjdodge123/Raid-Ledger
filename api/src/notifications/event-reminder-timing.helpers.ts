/**
 * Per-phase timing for the reminder cron (ROK-1201).
 *
 * `EventReminderService_handleReminders` is normally sub-100ms but spiked to
 * 1.3–3.7s on 8 of ~555 runs in a 9.4-hour window, with no error and no
 * fan-out volume to explain it. The wrapping `executeWithTracking` only
 * reports the total, so a spike says nothing about which phase produced it.
 *
 * These lines break the run into: candidate load, settings load, each
 * reminder window's dispatch, and the role-gap pass that follows. That is
 * enough to tell a slow query apart from a slow Discord dispatch in the next
 * production export, which the ticket's remaining ACs depend on.
 */
import { perfLog } from '../common/perf-logger';

type PhaseMeta = Record<string, string | number | null | undefined>;

/**
 * Time one phase and emit its PERF line.
 *
 * The timing is in a `finally` on purpose: a phase that throws is exactly the
 * one worth having a duration for, and losing it would leave the same blind
 * spot this instrumentation exists to close.
 */
export async function timedPhase<T>(
  phase: string,
  meta: PhaseMeta,
  run: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    perfLog(
      'CRON',
      `EventReminderService_${phase}`,
      performance.now() - start,
      meta,
    );
  }
}
