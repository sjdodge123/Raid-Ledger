/**
 * A write job and its `-rerun` follow-up (calendar-write.enqueue.helpers.ts)
 * must never run at the same time for one key. The rerun is queued with a 5 s
 * delay while the plain job is active; with `concurrency: 2` a plain job that
 * runs past 5 s would otherwise overlap it, and both would see "no link" and
 * create a Google copy each — a duplicate event (TECH-DEBT-BACKLOG, ROK-1596).
 * The reverse happens too: a plain job's retry backoff can expire while its
 * rerun is running.
 *
 * Why this shape: it needs no migration (no unique constraint makes the link
 * row claimable first), no per-key group/limiter (BullMQ Pro only) and no new
 * lock. The worker already marked this job `active` before `process` runs, so
 * when both start together each sees the other active and both defer — never
 * both run. Their different delays break that tie on the next round.
 */
import { DelayedError, type Job, type Queue } from 'bullmq';
import { WRITE_DEBOUNCE_MS, rerunJobId } from '../calendar-sync.constants';

const RERUN_SUFFIX = rerunJobId('');

/** The other job for the same key: plain ↔ `-rerun`. */
export function siblingJobId(jobId: string): string {
  return jobId.endsWith(RERUN_SUFFIX)
    ? jobId.slice(0, -RERUN_SUFFIX.length)
    : rerunJobId(jobId);
}

/** The rerun waits one debounce; the plain job twice that (tie-breaker). */
function deferMs(jobId: string): number {
  return jobId.endsWith(RERUN_SUFFIX)
    ? WRITE_DEBOUNCE_MS
    : 2 * WRITE_DEBOUNCE_MS;
}

/**
 * If this job's sibling is running, move this job back to delayed and throw
 * BullMQ's `DelayedError` (the worker then neither completes nor fails it,
 * and no attempt is spent). Returns normally when it is safe to run.
 */
export async function deferWhileSiblingActive(
  queue: Pick<Queue, 'getJobState'>,
  job: Pick<Job, 'id' | 'moveToDelayed'>,
  token: string | undefined,
): Promise<void> {
  if (!job.id) return;
  const state = await queue.getJobState(siblingJobId(job.id));
  if (state !== 'active') return;
  await job.moveToDelayed(Date.now() + deferMs(job.id), token);
  throw new DelayedError();
}
