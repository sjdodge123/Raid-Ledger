/**
 * Pure helper functions extracted from CronJobService for size compliance.
 */
import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
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

/** Record a skipped (paused) execution. */
export async function recordSkipped(
  db: Db,
  job: CronJobRow,
  jobName: string,
): Promise<void> {
  await db.insert(schema.cronJobExecutions).values({
    cronJobId: job.id,
    status: 'skipped',
    startedAt: new Date(),
    finishedAt: new Date(),
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
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  await db.insert(schema.cronJobExecutions).values({
    cronJobId: job.id,
    status: 'completed',
    startedAt,
    finishedAt,
    durationMs,
  });
  perfLog('CRON', jobName, durationMs, { status: 'completed' });
  const nextRunAt = computeNextRun(job.cronExpression);
  await db
    .update(schema.cronJobs)
    .set({ lastRunAt: finishedAt, nextRunAt, updatedAt: new Date() })
    .where(eq(schema.cronJobs.id, job.id));
  job.lastRunAt = finishedAt;
  if (nextRunAt) job.nextRunAt = nextRunAt;
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
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  await db.insert(schema.cronJobExecutions).values({
    cronJobId: job.id,
    status: 'failed',
    startedAt,
    finishedAt,
    durationMs,
    error: errorMessage,
  });
  perfLog('CRON', jobName, durationMs, { status: 'failed' });
  const nextRunAt = computeNextRun(job.cronExpression);
  await db
    .update(schema.cronJobs)
    .set({ lastRunAt: finishedAt, nextRunAt, updatedAt: new Date() })
    .where(eq(schema.cronJobs.id, job.id));
  job.lastRunAt = finishedAt;
  if (nextRunAt) job.nextRunAt = nextRunAt;
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

/** Look up a CronJob from the SchedulerRegistry, returning undefined if not found. */
export function getCronJobSafe(
  registry: SchedulerRegistry,
  name: string,
): ReturnType<SchedulerRegistry['getCronJob']> | undefined {
  try {
    return registry.getCronJob(name);
  } catch {
    return undefined;
  }
}

/** Minimal interface for a plugin CronRegistrar. */
interface PluginCronSource {
  getCronJobs(): { name: string; cronExpression: string }[];
}

/** Sync jobs from a single plugin CronRegistrar. */
export async function syncOnePluginRegistrar(
  db: Db,
  slug: string,
  reg: PluginCronSource,
  syncedNames: Set<string>,
  logger: Logger,
): Promise<void> {
  try {
    for (const pJob of reg.getCronJobs()) {
      const name = `${slug}:${pJob.name}`;
      if (syncedNames.has(name)) continue;
      await upsertPluginJob(db, slug, name, pJob.cronExpression);
      syncedNames.add(name);
      logger.log(`Synced plugin cron job: ${name}`);
    }
  } catch (err) {
    logger.error(`Failed to sync plugin cron registrar for ${slug}: ${err}`);
  }
}

/** Upsert a plugin cron job with standard defaults. */
async function upsertPluginJob(
  db: Db,
  slug: string,
  name: string,
  cronExpression: string,
): Promise<void> {
  await upsertJob(db, {
    name,
    source: 'plugin',
    pluginSlug: slug,
    cronExpression,
    description: null,
    category: 'Plugin',
    nextRunAt: computeNextRun(cronExpression),
  });
}

/** Get execution history for a specific job. */
export async function getExecutionHistory(db: Db, jobId: number, limit = 50) {
  return db
    .select()
    .from(schema.cronJobExecutions)
    .where(eq(schema.cronJobExecutions.cronJobId, jobId))
    .orderBy(desc(schema.cronJobExecutions.startedAt))
    .limit(limit);
}

/** Apply a schedule change at runtime via SchedulerRegistry. */
export function applyRuntimeSchedule(
  registry: SchedulerRegistry,
  name: string,
  cron: string,
  logger: Logger,
): void {
  try {
    const job = registry.getCronJob(name);
    void job.stop();
    job.setTime(new CronTime(cron));
    job.start();
    logger.log(`Runtime schedule updated for "${name}" → ${cron}`);
  } catch (err) {
    logger.warn(
      `Could not apply runtime schedule for "${name}": ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** Update a job's paused state and return the updated row. */
export async function setPaused(
  db: Db,
  id: number,
  paused: boolean,
): Promise<CronJobRow | undefined> {
  const [updated] = await db
    .update(schema.cronJobs)
    .set({ paused, updatedAt: new Date() })
    .where(eq(schema.cronJobs.id, id))
    .returning();
  return updated;
}
