/**
 * ROK-1762: shared guard for BullMQ enqueues that use a FIXED jobId.
 *
 * BullMQ ignores an `add` whose jobId already exists in ANY state — including
 * `completed` and `failed`. `removeOnComplete: N` / `removeOnFail: N` (or no
 * remove opts at all) RETAIN finished jobs, and prod Redis persists across
 * deploys, so one retained finished job silently turns every later same-id
 * enqueue into a no-op.
 *
 * This removes ONLY a finished (`completed` / `failed`) job. Pending jobs
 * (`waiting`, `delayed`, `prioritized`, ...) and `active` ones are left alone
 * so each call site keeps its own pending-job semantics (dedup, replace or
 * coalesce). Finished jobs are never picked up by a worker, so removing one
 * does not race a worker; `queue.remove` returns 0 instead of throwing when a
 * concurrent enqueuer removed it first.
 */
import type { JobState, Queue } from 'bullmq';

/** The state seen for the jobId, or `missing` when no job holds it. */
export type FinishedJobProbe = JobState | 'unknown' | 'missing';

/** Call before a fixed-jobId `queue.add` so a retained finished job never blocks it. */
export async function clearFinishedJob(
  queue: Pick<Queue, 'getJob' | 'remove'>,
  jobId: string,
): Promise<FinishedJobProbe> {
  const job = await queue.getJob(jobId);
  if (!job) return 'missing';
  const state = await job.getState();
  if (state === 'completed' || state === 'failed') {
    await queue.remove(jobId);
  }
  return state;
}
