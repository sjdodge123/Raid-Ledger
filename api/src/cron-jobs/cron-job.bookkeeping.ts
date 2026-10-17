/**
 * Per-run bookkeeping state for CronJobService (ROK-1380).
 *
 * Owns the two batched write buffers — queued `last_run_at` updates
 * (LastRunBuffer) and queued `cron_job_executions` rows (ExecutionBuffer) —
 * plus the periodic-prune counter. A completed/degraded run that defers its
 * last_run_at also defers its execution row, so both reach the DB on the same
 * flush cycle. Plain class (no DI), extracted to keep the service under the
 * 300-line cap.
 */
import { Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { PRUNE_EVERY_N_EXECUTIONS } from './cron-job.constants';
import { pruneExecutions } from './cron-job.helpers';
import { type ReresolveJob } from './cron-job.fk-recovery.helpers';
import { LastRunBuffer } from './cron-job.last-run-buffer';
import {
  ExecutionBuffer,
  type ParentRebinds,
  type QueuedExecution,
} from './cron-job.execution-buffer';
import { type RecordDeps } from './cron-job.execution.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export class CronRunBookkeeping {
  readonly lastRun = new LastRunBuffer();
  readonly executions = new ExecutionBuffer();
  /** Rows written per job since its last prune (counts written rows only). */
  readonly executionCounts = new Map<number, number>();
  /**
   * Set once shutdown begins: runs that finish afterwards write at once
   * instead of queueing behind a final flush that has already run.
   */
  private closing = false;

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly reresolve: ReresolveJob,
  ) {}

  /** Deps bundle threaded into the FK-aware outcome recorders (ROK-1328). */
  get recordDeps(): RecordDeps {
    return {
      db: this.db,
      logger: this.logger,
      reresolve: this.reresolve,
      onNoOp: (job) => this.lastRun.queueLiveness(job),
      deferRun: (job, jobName, values) => {
        if (this.closing) return false;
        if (!this.lastRun.deferCompleted(job, values.finishedAt)) return false;
        job.lastRunAt = values.finishedAt;
        this.executions.enqueue(job, jobName, values);
        return true;
      },
    };
  }

  /**
   * Count `count` written execution rows for a job and prune its history
   * every PRUNE_EVERY_N_EXECUTIONS rows. Never throws.
   */
  countWritten = async (cronJobId: number, count: number): Promise<void> => {
    const total = (this.executionCounts.get(cronJobId) ?? 0) + count;
    if (total < PRUNE_EVERY_N_EXECUTIONS) {
      this.executionCounts.set(cronJobId, total);
      return;
    }
    this.executionCounts.set(cronJobId, 0);
    await pruneExecutions(this.db, cronJobId).catch((err) =>
      this.logger.warn(
        `Failed to prune executions for job ${cronJobId}: ${err}`,
      ),
    );
  };

  /**
   * Flush queued execution rows (one multi-row INSERT), then queued
   * last_run_at values (one batched UPDATE). A last_run_at queued under a
   * stale job id follows its execution rows to the re-created job. A job
   * whose rows are still queued (a failed INSERT re-queued them) keeps its
   * last_run_at queued too, so the timestamp never lands without its row.
   */
  async flush(): Promise<void> {
    const rebinds = await this.executions.flush({
      db: this.db,
      logger: this.logger,
      reresolve: this.reresolve,
      onInserted: this.countWritten,
    });
    for (const [staleId, fresh] of rebinds) {
      this.lastRun.rebind(staleId, fresh);
    }
    const hold = jobsWithQueuedRows(this.executions.pending, rebinds);
    await this.lastRun.flush(this.db, this.logger, hold);
  }

  /**
   * Final flush on graceful shutdown. Stops deferring FIRST, so a run that
   * finishes after this point (an in-flight handler, or a tick before the
   * scheduler stops crons in beforeApplicationShutdown) writes its row and
   * last_run_at directly instead of into a queue nobody flushes again.
   */
  async close(): Promise<void> {
    this.closing = true;
    await this.flush();
  }
}

/** Ids (stale and rebound) of every job that still has a queued row. */
function jobsWithQueuedRows(
  pending: readonly QueuedExecution[],
  rebinds: ParentRebinds,
): Set<number> {
  const ids = new Set<number>();
  for (const { job } of pending) {
    ids.add(job.id);
    const fresh = rebinds.get(job.id);
    if (fresh) ids.add(fresh.id);
  }
  return ids;
}
