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
 * so a failed statement poisons nothing. The flush reports every stale→fresh
 * id rebind so the owner can move the job's queued last_run_at with it.
 *
 * Known trade (accepted): an INSERT that commits but whose reply is lost
 * (connection reset) is re-queued and written twice on the next cycle.
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

/**
 * Stale cached `cron_jobs.id` → the re-created row it was rebound to. The
 * full row travels so a rebound last_run_at can take the fresh schedule.
 */
export type ParentRebinds = Map<number, CronJobRow>;

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
    this.trimOverflow();
  }

  /** Drop the oldest rows past MAX_QUEUED_EXECUTIONS; returns how many. */
  private trimOverflow(): number {
    const overflow = this.pending.length - MAX_QUEUED_EXECUTIONS;
    if (overflow > 0) this.pending.splice(0, overflow);
    return Math.max(0, overflow);
  }

  /**
   * Write every queued row in one multi-row INSERT and drain the buffer. A
   * non-FK failure re-queues the batch (still capped) for the next cycle.
   * Returns the parent rebinds made while binding rows; never throws.
   */
  async flush(deps: ExecutionFlushDeps): Promise<ParentRebinds> {
    const rebinds: ParentRebinds = new Map();
    if (this.pending.length === 0) return rebinds;
    const batch = this.pending.splice(0);
    let rows: QueuedExecution[];
    try {
      rows = await bindLiveParents(deps, batch, rebinds);
      if (rows.length === 0) return rebinds;
      await deps.db.insert(schema.cronJobExecutions).values(rows.map(toInsert));
    } catch (err) {
      if (!isForeignKeyViolation(err)) {
        this.requeue(deps.logger, batch, err);
        return rebinds;
      }
      // Re-runs the ORIGINAL batch: rows the pre-check dropped (job gone) are
      // re-resolved once more on the per-row path. Harmless, rare.
      rows = await insertEachRow(deps, batch, rebinds);
    }
    await reportInserted(deps, rows);
    return rebinds;
  }

  /** Put a failed batch back in front of rows queued meanwhile, re-capped. */
  private requeue(logger: Logger, batch: QueuedExecution[], err: unknown) {
    logger.warn(`Failed to flush cron execution rows: ${String(err)}`);
    this.pending.unshift(...batch);
    const dropped = this.trimOverflow();
    if (dropped > 0) {
      logger.warn(
        `Cron execution queue over ${MAX_QUEUED_EXECUTIONS} rows after a ` +
          `failed flush; dropped the ${dropped} oldest.`,
      );
    }
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
  rebinds: ParentRebinds,
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
    if (!job) continue;
    rebinds.set(row.job.id, job);
    out.push({ ...row, job });
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
  rebinds: ParentRebinds,
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
      if (!job) continue;
      if (job.id !== row.job.id) rebinds.set(row.job.id, job);
      landed.push({ ...row, job });
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
