/**
 * In-memory buffer of pending `cron_jobs.last_run_at` writes (ROK-1380).
 *
 * No-op liveness heartbeats and completed/degraded runs queue here and reach
 * the DB through ONE batched UPDATE per flush cycle (ROK-1414) instead of a
 * per-run single-row UPDATE — on the disk-latency-bound NAS the per-write
 * commit/fsync roundtrip dominated cron bookkeeping cost. Failed runs never
 * queue here, and admin manual triggers are marked so their run writes
 * immediately (the admin panel re-reads `last_run_at` right after "Run now").
 *
 * Only high-frequency jobs defer (see `isDeferrableSchedule`): the write
 * amplification comes from them, and the API registers no shutdown hooks, so
 * a deploy drops whatever is still queued. A daily or weekly job writes its
 * run at once rather than showing the previous run until the next one; a
 * high-frequency job's lost value is replaced within one interval.
 *
 * Plain class (no DI) owned by CronJobService, extracted to keep that file
 * under the 300-line cap.
 */
import { Logger } from '@nestjs/common';
import { CronTime } from 'cron';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { NOOP_LIVENESS_INTERVAL_MS } from './cron-job.constants';
import { flushPendingUpdates } from './cron-job.flush.helpers';
import { shouldUpdateLiveness } from './cron-job.helpers';

type CronJobRow = typeof schema.cronJobs.$inferSelect;
type Db = PostgresJsDatabase<typeof schema>;

/** Longest schedule interval whose completed runs are deferred. */
export const DEFER_MAX_INTERVAL_MS = 15 * 60 * 1000;

const deferrableBySchedule = new Map<string, boolean>();

/**
 * Whether a schedule fires at least every DEFER_MAX_INTERVAL_MS, judged by
 * the gap between its next two fire times (cached per expression). An
 * unparseable expression writes immediately.
 */
export function isDeferrableSchedule(cronExpression: string): boolean {
  const cached = deferrableBySchedule.get(cronExpression);
  if (cached !== undefined) return cached;
  const deferrable = scheduleGapMs(cronExpression) <= DEFER_MAX_INTERVAL_MS;
  deferrableBySchedule.set(cronExpression, deferrable);
  return deferrable;
}

/** Gap between a schedule's next two fire times; Infinity if unparseable. */
function scheduleGapMs(cronExpression: string): number {
  try {
    const [first, second] = new CronTime(cronExpression).sendAt(2);
    const gapMs = second.toMillis() - first.toMillis();
    return gapMs > 0 ? gapMs : Infinity;
  } catch {
    return Infinity;
  }
}

/** One queued last_run_at write; next_run_at is derived at flush time. */
export interface PendingLastRun {
  lastRunAt: Date;
  cronExpression: string;
}

export class LastRunBuffer {
  /** Queued writes keyed by cron_jobs.id (latest value wins). */
  readonly pending = new Map<number, PendingLastRun>();
  /** Job names whose NEXT completed run must write immediately. */
  private readonly immediate = new Set<string>();

  /** Queue a liveness heartbeat for a no-op run if the last one is stale. */
  queueLiveness(job: CronJobRow): void {
    if (!shouldUpdateLiveness(job.lastRunAt, NOOP_LIVENESS_INTERVAL_MS)) return;
    const now = new Date();
    this.pending.set(job.id, {
      lastRunAt: now,
      cronExpression: job.cronExpression,
    });
    job.lastRunAt = now;
  }

  /** Make the next completed/degraded run of `jobName` write immediately. */
  markImmediate(jobName: string): void {
    this.immediate.add(jobName);
  }

  /**
   * Queue a completed/degraded run's last_run_at. Returns false — the caller
   * must write now — when the job was marked immediate (the mark is consumed)
   * or its schedule is not high-frequency. Any older queued value for the job
   * is then dropped so a later flush cannot roll the immediate write back.
   */
  deferCompleted(job: CronJobRow, finishedAt: Date): boolean {
    const marked = this.immediate.delete(job.name);
    if (marked || !isDeferrableSchedule(job.cronExpression)) {
      this.pending.delete(job.id);
      return false;
    }
    this.pending.set(job.id, {
      lastRunAt: finishedAt,
      cronExpression: job.cronExpression,
    });
    return true;
  }

  /** Write every queued value in one batched UPDATE and drain the buffer. */
  flush(db: Db, logger: Logger): Promise<void> {
    return flushPendingUpdates(db, this.pending, logger);
  }
}
