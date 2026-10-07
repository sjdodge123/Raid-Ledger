/**
 * Batched `cron_job_executions` writes (ROK-1380 part B).
 *
 * A completed/degraded run of a high-frequency job (the same runs whose
 * last_run_at is deferred, see LastRunBuffer) queues its execution row here
 * instead of issuing a per-run single-row INSERT. Each flush cycle then writes
 * every queued row in ONE multi-row INSERT — on the disk-latency-bound NAS the
 * per-write commit/fsync roundtrip, not the statement, is the cost.
 *
 * FK safety (ROK-1328): a queued row can carry a stale cached `job.id` whose
 * `cron_jobs` parent was deleted (fleet reset, restore, manual delete). One
 * such row would reject the whole multi-row INSERT with 23503, so the flush
 * pre-checks which parents still exist and re-resolves the missing ones by
 * name — rebinding to a re-created row or dropping the row when the job is
 * gone. If a parent vanishes between that check and the INSERT, the batch
 * falls back to the per-row self-healing insert. No transaction is involved,
 * so a failed statement poisons nothing.
 *
 * Plain class (no DI) owned by CronRunBookkeeping.
 */
import { Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  insertExecutionRow,
  isForeignKeyViolation,
  type ExecutionValues,
  type ReresolveJob,
} from './cron-job.fk-recovery.helpers';

type CronJobRow = typeof schema.cronJobs.$inferSelect;
type Db = PostgresJsDatabase<typeof schema>;

/** Most rows kept queued; on overflow the oldest are dropped. */
export const MAX_QUEUED_EXECUTIONS = 1000;

/** One queued execution-history row. */
export interface QueuedExecution {
  job: CronJobRow;
  jobName: string;
  values: ExecutionValues;
}

/** What a flush needs from its owner. */
export interface ExecutionFlushDeps {
  db: Db;
  logger: Logger;
  reresolve: ReresolveJob;
  /** Called once per job with the number of rows actually written. */
  onInserted: (cronJobId: number, count: number) => Promise<void>;
}

export class ExecutionBuffer {
  readonly pending: QueuedExecution[] = [];

  /** Queue one execution row for the next flush. */
  enqueue(job: CronJobRow, jobName: string, values: ExecutionValues): void {
    this.pending.push({ job, jobName, values });
    const overflow = this.pending.length - MAX_QUEUED_EXECUTIONS;
    if (overflow > 0) this.pending.splice(0, overflow);
  }

  /**
   * Write every queued row in one multi-row INSERT and drain the buffer. A
   * non-FK failure re-queues the batch for the next cycle; never throws.
   */
  async flush(deps: ExecutionFlushDeps): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    let rows: QueuedExecution[];
    try {
      rows = await bindLiveParents(deps, batch);
      if (rows.length === 0) return;
      await deps.db.insert(schema.cronJobExecutions).values(rows.map(toInsert));
    } catch (err) {
      if (!isForeignKeyViolation(err)) {
        deps.logger.warn(`Failed to flush cron execution rows: ${err}`);
        this.pending.unshift(...batch.slice(-MAX_QUEUED_EXECUTIONS));
        return;
      }
      rows = await insertEachRow(deps, batch);
    }
    await reportInserted(deps, rows);
  }
}

/** Insert values for one queued row. */
function toInsert(row: QueuedExecution) {
  return { cronJobId: row.job.id, ...row.values };
}

/**
 * Keep rows whose parent `cron_jobs` row exists. Rows with a missing parent
 * are re-resolved by name once per job: rebound to the fresh row, or dropped
 * (with a warn) when the job is genuinely gone.
 */
async function bindLiveParents(
  deps: ExecutionFlushDeps,
  batch: QueuedExecution[],
): Promise<QueuedExecution[]> {
  const ids = [...new Set(batch.map((r) => r.job.id))];
  const live = await deps.db
    .select({ id: schema.cronJobs.id })
    .from(schema.cronJobs)
    .where(inArray(schema.cronJobs.id, ids));
  const liveIds = new Set(live.map((r) => r.id));
  const fresh = new Map<string, CronJobRow | null>();
  const out: QueuedExecution[] = [];
  for (const row of batch) {
    if (liveIds.has(row.job.id)) {
      out.push(row);
      continue;
    }
    if (!fresh.has(row.jobName)) {
      fresh.set(row.jobName, await reresolveMissing(deps, row));
    }
    const job = fresh.get(row.jobName);
    if (job) out.push({ ...row, job });
  }
  return out;
}

/** Re-resolve one job whose cached id no longer exists. */
async function reresolveMissing(
  deps: ExecutionFlushDeps,
  row: QueuedExecution,
): Promise<CronJobRow | null> {
  const job = await deps.reresolve(row.jobName);
  if (!job) {
    deps.logger.warn(
      `Cron job "${row.jobName}" no longer exists; dropping its queued ` +
        `execution row(s).`,
    );
  }
  return job;
}

/**
 * Fallback after the batch INSERT hit FK 23503 (a parent deleted after the
 * pre-check): insert row by row through the self-healing single-row path.
 * Returns the rows that landed, bound to the job they landed against.
 */
async function insertEachRow(
  deps: ExecutionFlushDeps,
  batch: QueuedExecution[],
): Promise<QueuedExecution[]> {
  const landed: QueuedExecution[] = [];
  for (const row of batch) {
    try {
      const job = await insertExecutionRow(
        deps.db,
        row.job,
        row.jobName,
        row.values,
        deps.reresolve,
        deps.logger,
      );
      if (job) landed.push({ ...row, job });
    } catch (err) {
      deps.logger.warn(
        `Dropped queued execution row for "${row.jobName}": ${err}`,
      );
    }
  }
  return landed;
}

/** Tell the owner how many rows landed per job (drives prune bookkeeping). */
async function reportInserted(
  deps: ExecutionFlushDeps,
  rows: QueuedExecution[],
): Promise<void> {
  const counts = new Map<number, number>();
  for (const { job } of rows) counts.set(job.id, (counts.get(job.id) ?? 0) + 1);
  for (const [id, count] of counts) await deps.onInserted(id, count);
}
