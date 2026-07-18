/**
 * Pure helper functions extracted from CronJobService for size compliance.
 */
import { Logger } from '@nestjs/common';
import { CronTime } from 'cron';
import { eq, desc, and, lt, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { perfLog } from '../common/perf-logger';
import * as schema from '../drizzle/schema';
import {
  CORE_JOB_METADATA,
  MAX_EXECUTIONS_PER_JOB,
} from './cron-job.constants';
import {
  insertExecutionRow,
  type ReresolveJob,
} from './cron-job.fk-recovery.helpers';

type CronJobRow = typeof schema.cronJobs.$inferSelect;
type Db = PostgresJsDatabase<typeof schema>;

/** Compute the next fire time from a cron expression. */
export function computeNextRun(cronExpression: string): Date | null {
  try {
    const ct = new CronTime(cronExpression);
    const next = ct.sendAt();
    return next.toJSDate ? next.toJSDate() : new Date(next.toString());
  } catch {
    return null;
  }
}

/** Parameters for upserting a cron job. */
export interface UpsertJobParams {
  name: string;
  source: string;
  pluginSlug: string | null;
  cronExpression: string;
  description: string | null;
  category: string;
  nextRunAt: Date | null;
}

/** Upsert a single cron job into the DB. */
export async function upsertJob(db: Db, p: UpsertJobParams): Promise<void> {
  await db
    .insert(schema.cronJobs)
    .values({ ...p, paused: false })
    .onConflictDoUpdate({
      target: schema.cronJobs.name,
      set: {
        cronExpression: p.cronExpression,
        source: p.source,
        pluginSlug: p.pluginSlug,
        description: p.description ?? sql`${schema.cronJobs.description}`,
        category: p.category,
        nextRunAt: p.nextRunAt,
        updatedAt: new Date(),
      },
    });
}

/** Prune execution history beyond MAX_EXECUTIONS_PER_JOB. */
export async function pruneExecutions(
  db: Db,
  cronJobId: number,
): Promise<void> {
  const rows = await db
    .select({ id: schema.cronJobExecutions.id })
    .from(schema.cronJobExecutions)
    .where(eq(schema.cronJobExecutions.cronJobId, cronJobId))
    .orderBy(desc(schema.cronJobExecutions.startedAt))
    .limit(1)
    .offset(MAX_EXECUTIONS_PER_JOB);
  if (rows.length === 0) return;
  const cutoffId = rows[0].id;
  await db
    .delete(schema.cronJobExecutions)
    .where(
      and(
        eq(schema.cronJobExecutions.cronJobId, cronJobId),
        lt(schema.cronJobExecutions.id, cutoffId),
      ),
    );
}

/** Insert an execution row, log it, and update the job's timestamps. */
async function recordExecution(
  db: Db,
  job: CronJobRow,
  jobName: string,
  status: string,
  startedAt: Date,
  finishedAt: Date,
  error?: string,
  reresolve?: ReresolveJob,
  logger?: Logger,
): Promise<void> {
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const inserted = await insertExecutionRow(
    db,
    job,
    jobName,
    { status, startedAt, finishedAt, durationMs, error },
    reresolve,
    logger,
  );
  perfLog('CRON', jobName, durationMs, { status });
  if (!inserted) return;
  const nextRunAt = computeNextRun(inserted.cronExpression);
  await db
    .update(schema.cronJobs)
    .set({ lastRunAt: finishedAt, nextRunAt, updatedAt: new Date() })
    .where(eq(schema.cronJobs.id, inserted.id));
  inserted.lastRunAt = finishedAt;
  if (nextRunAt) inserted.nextRunAt = nextRunAt;
}

/** Record a no-op execution (handler ran but found nothing to do). */
export function recordNoOp(
  jobName: string,
  startedAt: Date,
  finishedAt: Date,
): void {
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  perfLog('CRON', jobName, durationMs, { status: 'no-op' });
}

/** Check whether enough time has elapsed for a liveness heartbeat update. */
export function shouldUpdateLiveness(
  lastRunAt: Date | null,
  intervalMs: number,
): boolean {
  if (!lastRunAt) return true;
  return Date.now() - lastRunAt.getTime() >= intervalMs;
}

/** Record a skipped (paused) execution. */
export async function recordSkipped(
  db: Db,
  job: CronJobRow,
  jobName: string,
  reresolve?: ReresolveJob,
  logger?: Logger,
): Promise<void> {
  const now = new Date();
  await insertExecutionRow(
    db,
    job,
    jobName,
    { status: 'skipped', startedAt: now, finishedAt: now, durationMs: 0 },
    reresolve,
    logger,
  );
  perfLog('CRON', jobName, 0, { status: 'skipped' });
}

/** Record a completed execution and update job timestamps. */
export async function recordCompleted(
  db: Db,
  job: CronJobRow,
  jobName: string,
  startedAt: Date,
  finishedAt: Date,
  reresolve?: ReresolveJob,
  logger?: Logger,
): Promise<void> {
  await recordExecution(
    db,
    job,
    jobName,
    'completed',
    startedAt,
    finishedAt,
    undefined,
    reresolve,
    logger,
  );
}

/**
 * Record a degraded execution (ROK-1197). The handler ran to completion but
 * reported partial failure (e.g. some upstream calls timed out). Emits a PERF
 * line with `status=degraded` and persists an execution row with the same
 * status — the DB column is a free-form string.
 */
export async function recordDegraded(
  db: Db,
  job: CronJobRow,
  jobName: string,
  startedAt: Date,
  finishedAt: Date,
  reresolve?: ReresolveJob,
  logger?: Logger,
): Promise<void> {
  await recordExecution(
    db,
    job,
    jobName,
    'degraded',
    startedAt,
    finishedAt,
    undefined,
    reresolve,
    logger,
  );
}

/** Record a failed execution and update job timestamps. */
export async function recordFailed(
  db: Db,
  job: CronJobRow,
  jobName: string,
  startedAt: Date,
  finishedAt: Date,
  errorMessage: string,
  logger: Logger,
  reresolve?: ReresolveJob,
): Promise<void> {
  await recordExecution(
    db,
    job,
    jobName,
    'failed',
    startedAt,
    finishedAt,
    errorMessage,
    reresolve,
    logger,
  );
  logger.error(`Cron job "${jobName}" failed: ${errorMessage}`);
}

/** Result type for extractRegistryJobMeta. */
export type RegistryJobMeta = Omit<UpsertJobParams, 'name' | 'nextRunAt'>;

/** Extract the cron expression string from a CronJob's cronTime. */
function parseCronTime(cronTime: unknown): string {
  if (
    typeof cronTime === 'object' &&
    cronTime !== null &&
    'source' in cronTime
  ) {
    return String(cronTime.source);
  }
  return String(cronTime);
}

/** Extract metadata for a registry job entry. Returns null to skip. */
export function extractRegistryJobMeta(
  name: string,
  job: { cronTime: unknown },
  logger: Logger,
): RegistryJobMeta | null {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name)) {
    logger.error(
      `Skipping cron job with auto-generated name "${name}". ` +
        'Add { name: "ClassName_methodName" } to the @Cron decorator.',
    );
    return null;
  }
  const isPlugin = name.includes(':') && !name.startsWith('core:');
  const meta = CORE_JOB_METADATA[name];
  if (!isPlugin && !meta) {
    logger.warn(`Core cron job "${name}" is missing CORE_JOB_METADATA entry.`);
  }
  return {
    source: isPlugin ? 'plugin' : 'core',
    pluginSlug: isPlugin ? name.split(':')[0] : null,
    cronExpression: parseCronTime(job.cronTime),
    category: meta?.category ?? (isPlugin ? 'Plugin' : 'Other'),
    description: meta?.description ?? null,
  };
}

/**
 * Flush pending last_run_at updates to DB (ROK-1414).
 *
 * On the disk-latency-bound NAS, per-job single-row UPDATEs dominated the
 * ≥100ms app-observed query load — the cost is the per-write commit/fsync
 * roundtrip, not the statement itself. So this issues exactly ONE batched
 * UPDATE per flush cycle covering every pending job (via a `VALUES` join),
 * regardless of how many jobs are queued.
 *
 * Dates are serialised with `toISOString()` and cast to `timestamp` to match
 * drizzle's own `PgTimestamp.mapToDriverValue`, so stored values are identical
 * to the previous per-row path. Every pending entry is already a genuine
 * change (see `queueLivenessIfStale`, which only queues when the value moves
 * and immediately advances the in-memory `lastRunAt`), so no separate
 * unchanged-row skip is needed.
 */
export async function flushPendingUpdates(
  db: Db,
  pending: Map<number, { lastRunAt: Date; cronExpression: string }>,
  logger: Logger,
): Promise<void> {
  if (pending.size === 0) return;
  const updates = new Map(pending);
  pending.clear();
  try {
    // Built inside the try: toISOString() throws on an invalid Date, and that
    // must degrade to the same warn-and-skip as a DB failure, not escape to
    // the flush interval (the old per-row loop caught it per-job).
    const rows = Array.from(updates, ([id, { lastRunAt, cronExpression }]) =>
      flushValuesRow(id, lastRunAt, cronExpression),
    );
    await db.execute(sql`
      UPDATE ${schema.cronJobs} AS c
         SET last_run_at = v.last_run_at, next_run_at = v.next_run_at,
             updated_at = ${new Date().toISOString()}::timestamp
        FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, last_run_at, next_run_at)
       WHERE c.id = v.id
    `);
  } catch (err) {
    const ids = Array.from(updates.keys()).join(', ');
    logger.warn(`Failed to flush last_run_at for job(s) ${ids}: ${err}`);
    return;
  }
  logger.debug(`Flushed last_run_at for ${updates.size} cron job(s)`);
}

/** Build one `VALUES` tuple (id, last_run_at, next_run_at) for the batched flush. */
function flushValuesRow(id: number, lastRunAt: Date, cronExpression: string) {
  const nextRunAt = computeNextRun(cronExpression);
  return sql`(${id}::int, ${lastRunAt.toISOString()}::timestamp, ${
    nextRunAt ? nextRunAt.toISOString() : null
  }::timestamp)`;
}

/** Record a skipped trigger for a job not in the SchedulerRegistry. */
export async function recordSkippedTrigger(
  db: Db,
  job: CronJobRow,
  logger: Logger,
): Promise<void> {
  logger.warn(
    `Cron job "${job.name}" not in SchedulerRegistry — cannot trigger`,
  );
  await db.insert(schema.cronJobExecutions).values({
    cronJobId: job.id,
    status: 'skipped',
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 0,
    error: 'Job not in SchedulerRegistry — could not be triggered',
  });
}
