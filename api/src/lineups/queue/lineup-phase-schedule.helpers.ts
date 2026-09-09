/**
 * Best-effort wrapper around `LineupPhaseQueueService.scheduleTransition`
 * (ROK-1512).
 *
 * `scheduleTransition` REPORTS a failed enqueue to Sentry and RETHROWS. It
 * used to swallow the failure into `logger.error`, which hid a BullMQ job-id
 * rejection for two ROK-1443 gate rounds — the deadline job silently ceased
 * to exist and the lineup sat stuck.
 *
 * Every existing caller schedules AFTER its DB write has committed, and boot
 * rehydration (`LineupPhaseProcessor.rehydratePendingJobs`,
 * `LineupPhaseQueueService.reconcileArchiveJobs`) re-derives the job from the
 * row. At those sites the row is authoritative: a throw would only turn an
 * already-committed mutation into a 500 (or abort a boot loop half-way), so
 * they opt into best-effort HERE, explicitly and per call site, instead of
 * the queue hiding the failure for everyone.
 *
 * Sentry has already captured the failure inside `scheduleTransition`; this
 * wrapper only logs the caller-side context and keeps going.
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('LineupPhaseSchedule');

/** The one method this wrapper needs — keeps it free of the queue import. */
export interface TransitionScheduler {
  scheduleTransition(
    lineupId: number,
    targetStatus: string,
    delayMs: number,
  ): Promise<void>;
}

/**
 * Schedule a phase transition, swallowing (but logging) a failed enqueue.
 *
 * @param site - Caller name for the log line (e.g. `createLineup`).
 * @returns `true` when the job was scheduled, `false` when the enqueue failed.
 */
export async function scheduleTransitionBestEffort(
  queue: TransitionScheduler,
  lineupId: number,
  targetStatus: string,
  delayMs: number,
  site: string,
): Promise<boolean> {
  try {
    await queue.scheduleTransition(lineupId, targetStatus, delayMs);
    return true;
  } catch (error) {
    logger.warn(
      `[${site}] ${targetStatus} deadline job for lineup ${lineupId} not scheduled ` +
        `(row is authoritative; boot rehydration re-derives it): ` +
        `${error instanceof Error ? error.message : 'Unknown'}`,
    );
    return false;
  }
}
