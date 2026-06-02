/**
 * Handler-outcome orchestration for CronJobService (ROK-1328).
 *
 * Centralizes the success/failure recording path so a stale cached `job.id`
 * can never re-throw the `cron_job_executions_cron_job_id_fkey` FK (SQLSTATE
 * 23503) on every cron tick. Extracted from cron-job.service.ts to keep that
 * file under the 300-line cap; the FK self-heal itself lives in the record*
 * helpers (via insertExecutionRow / reresolve).
 */
import { Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  recordNoOp,
  recordCompleted,
  recordDegraded,
  recordFailed,
} from './cron-job.helpers';
import { type ReresolveJob } from './cron-job.fk-recovery.helpers';

type CronJobRow = typeof schema.cronJobs.$inferSelect;
type Db = PostgresJsDatabase<typeof schema>;
type HandlerResult = void | boolean | { degraded: true };

/** Dependencies for the handler-outcome recorders. */
export interface RecordDeps {
  db: Db;
  logger: Logger;
  reresolve: ReresolveJob;
  /** Queue a liveness heartbeat for a no-op run (mutates service state). */
  onNoOp: (job: CronJobRow) => void;
}

/**
 * Record a successful handler result (no-op / degraded / completed).
 * Returns whether an execution row was inserted (no-op inserts nothing).
 */
async function recordHandlerSuccess(
  deps: RecordDeps,
  job: CronJobRow,
  jobName: string,
  startedAt: Date,
  result: HandlerResult,
): Promise<boolean> {
  const finishedAt = new Date();
  if (result === false) {
    recordNoOp(jobName, startedAt, finishedAt);
    deps.onNoOp(job);
    return false;
  }
  const degraded =
    typeof result === 'object' && result !== null && result.degraded === true;
  const record = degraded ? recordDegraded : recordCompleted;
  await record(
    deps.db,
    job,
    jobName,
    startedAt,
    finishedAt,
    deps.reresolve,
    deps.logger,
  );
  return true;
}

/**
 * Record a handler failure, self-healing a stale FK and never bubbling
 * (AC-4). The catch-side recordFailed used to re-throw the same FK 23503 (1k+
 * Sentry events in 11h). We pass `reresolve` so a dead cached id recovers,
 * then wrap in our own try/catch so a SECOND failure logs (not Sentry) and
 * never escapes the cron tick.
 */
async function recordHandlerFailure(
  deps: RecordDeps,
  job: CronJobRow,
  jobName: string,
  startedAt: Date,
  msg: string,
): Promise<boolean> {
  try {
    await recordFailed(
      deps.db,
      job,
      jobName,
      startedAt,
      new Date(),
      msg,
      deps.logger,
      deps.reresolve,
    );
    return true;
  } catch (recordErr) {
    deps.logger.error(
      `Cron job "${jobName}" failed AND its failure-record insert failed: ` +
        `${recordErr} (original error: ${msg})`,
    );
    return false;
  }
}

/**
 * Run a handler and record its outcome (success or failure). Returns whether
 * an execution row was inserted, so the caller's prune bookkeeping stays
 * correct.
 */
export async function runHandlerTracked(
  deps: RecordDeps,
  job: CronJobRow,
  jobName: string,
  fn: () => Promise<HandlerResult>,
): Promise<boolean> {
  const startedAt = new Date();
  try {
    const result = await fn();
    return await recordHandlerSuccess(deps, job, jobName, startedAt, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await recordHandlerFailure(deps, job, jobName, startedAt, msg);
  }
}
