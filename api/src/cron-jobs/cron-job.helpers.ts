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
): Promise<void> {
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  await db.insert(schema.cronJobExecutions).values({
    cronJobId: job.id,
    status,
    startedAt,
    finishedAt,
    durationMs,
    error,
  });
  perfLog('CRON', jobName, durationMs, { status });
  const nextRunAt = computeNextRun(job.cronExpression);
  await db
    .update(schema.cronJobs)
    .set({ lastRunAt: finishedAt, nextRunAt, updatedAt: new Date() })
    .where(eq(schema.cronJobs.id, job.id));
  job.lastRunAt = finishedAt;
  if (nextRunAt) job.nextRunAt = nextRunAt;
}

/** Record a no-op execution (handler ran but found nothing to do). */
export async function recordNoOp(
  db: Db,
  job: CronJobRow,
  jobName: string,
  startedAt: Date,
  finishedAt: Date,
): Promise<void> {
  await recordExecution(db, job, jobName, 'no-op', startedAt, finishedAt);
}

/** Record a skipped (paused) execution. */
export async function recordSkipped(
  db: Db,
  job: CronJobRow,
  jobName: string,
): Promise<void> {
  const now = new Date();
  await db.insert(schema.cronJobExecutions).values({
    cronJobId: job.id,
    status: 'skipped',
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
  });
  perfLog('CRON', jobName, 0, { status: 'skipped' });
}

/** Record a completed execution and update job timestamps. */
export async function recordCompleted(
  db: Db,
  job: CronJobRow,
  jobName: string,
  startedAt: Date,
  finishedAt: Date,
): Promise<void> {
  await recordExecution(db, job, jobName, 'completed', startedAt, finishedAt);
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
): Promise<void> {
  await recordExecution(
    db,
    job,
    jobName,
    'failed',
    startedAt,
    finishedAt,
    errorMessage,
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

/** Flush pending last_run_at updates to DB. */
export async function flushPendingUpdates(
  db: Db,
  pending: Map<number, { lastRunAt: Date; cronExpression: string }>,
  logger: Logger,
): Promise<void> {
  if (pending.size === 0) return;
  const updates = new Map(pending);
  pending.clear();
  const now = new Date();
  for (const [jobId, { lastRunAt, cronExpression }] of updates) {
    try {
      const nextRunAt = computeNextRun(cronExpression);
      await db
        .update(schema.cronJobs)
        .set({ lastRunAt, nextRunAt, updatedAt: now })
        .where(eq(schema.cronJobs.id, jobId));
    } catch (err) {
      logger.warn(`Failed to flush last_run_at for job ${jobId}: ${err}`);
    }
  }
  logger.debug(`Flushed last_run_at for ${updates.size} cron job(s)`);
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
