/**
 * FK self-heal helpers for CronJobService (ROK-1328).
 *
 * Extracted from cron-job.helpers.ts to keep both files under the 300-line
 * cap. These cover the stale-cache recovery path: the in-memory jobCache can
 * hold a `job.id` whose `cron_jobs` row was deleted (fleet clone/reset, backup
 * restore, manual delete), and every subsequent execution-row insert then
 * violates the `cron_job_executions_cron_job_id_fkey` FK (SQLSTATE 23503).
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type CronJobRow = typeof schema.cronJobs.$inferSelect;
type Db = PostgresJsDatabase<typeof schema>;

/**
 * Re-resolve a job row by name from the source of truth. Returns the fresh row
 * (and refreshes the caller's cache), or null when the row is genuinely gone.
 */
export type ReresolveJob = (jobName: string) => Promise<CronJobRow | null>;

/** Values for an execution-history insert. */
export interface ExecutionValues {
  status: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  error?: string;
}

/** SELECT a single cron job row by its name (or null). Shared by the service's
 * cache-first resolveJob and the FK-recovery reresolveJob. */
export async function selectJobByName(
  db: Db,
  jobName: string,
): Promise<CronJobRow | null> {
  const [row] = await db
    .select()
    .from(schema.cronJobs)
    .where(eq(schema.cronJobs.name, jobName))
    .limit(1);
  return row ?? null;
}

/**
 * Check if a DB error is a foreign-key constraint violation (SQLSTATE 23503).
 * Mirrors `isUniqueViolation` (lineups-nomination.helpers.ts): newer drizzle
 * wraps the postgres.PostgresError in a DrizzleQueryError, so the SQLSTATE may
 * live on `err` directly OR on `err.cause`.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  if (e.code === '23503') return true;
  if (e.cause && typeof e.cause === 'object') {
    return (e.cause as Record<string, unknown>).code === '23503';
  }
  return false;
}

/**
 * Insert an execution row, self-healing a stale cached `job.id`. On FK
 * violation (23503 — the cached row's id was deleted out from under us) we
 * re-resolve the job by name ONCE: if it's gone we warn + skip the row (no
 * throw, no Sentry); if it came back with a fresh id we rebind and retry the
 * insert exactly once (no inner catch — never recurse). Returns the row that
 * the insert ultimately succeeded against (rebound on retry), or null when the
 * job is gone and nothing was inserted.
 */
export async function insertExecutionRow(
  db: Db,
  job: CronJobRow,
  jobName: string,
  values: ExecutionValues,
  reresolve?: ReresolveJob,
  logger?: Logger,
): Promise<CronJobRow | null> {
  try {
    await db
      .insert(schema.cronJobExecutions)
      .values({ cronJobId: job.id, ...values });
    return job;
  } catch (err) {
    if (!isForeignKeyViolation(err) || !reresolve) throw err;
    logger?.warn(
      `Cron job "${jobName}" execution insert hit FK 23503 (stale cached ` +
        `id ${job.id}); re-resolving.`,
    );
    const fresh = await reresolve(jobName);
    if (!fresh) {
      logger?.warn(
        `Cron job "${jobName}" no longer exists; skipping execution row.`,
      );
      return null;
    }
    await db
      .insert(schema.cronJobExecutions)
      .values({ cronJobId: fresh.id, ...values });
    return fresh;
  }
}
