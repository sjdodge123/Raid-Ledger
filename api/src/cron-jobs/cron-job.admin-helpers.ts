/**
 * Admin/runtime helpers for cron job management.
 * Extracted from cron-job.helpers.ts for file size compliance.
 */
import { BadRequestException, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronTime } from 'cron';
import { eq, desc } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { computeNextRun, upsertJob } from './cron-job.helpers';

type CronJobRow = typeof schema.cronJobs.$inferSelect;
type Db = PostgresJsDatabase<typeof schema>;

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
      await upsertJob(db, {
        name,
        source: 'plugin',
        pluginSlug: slug,
        cronExpression: pJob.cronExpression,
        description: null,
        category: 'Plugin',
        nextRunAt: computeNextRun(pJob.cronExpression),
      });
      syncedNames.add(name);
      logger.log(`Synced plugin cron job: ${name}`);
    }
  } catch (err) {
    logger.error(`Failed to sync plugin cron registrar for ${slug}: ${err}`);
  }
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

/** Validate and apply a schedule change, returning the updated row. */
export async function updateJobSchedule(
  db: Db,
  registry: SchedulerRegistry,
  id: number,
  cronExpression: string,
  logger: Logger,
): Promise<CronJobRow | undefined> {
  try {
    new CronTime(cronExpression);
  } catch {
    throw new BadRequestException(
      `Invalid cron expression: "${cronExpression}"`,
    );
  }
  const nextRunAt = computeNextRun(cronExpression);
  const [updated] = await db
    .update(schema.cronJobs)
    .set({ cronExpression, nextRunAt, updatedAt: new Date() })
    .where(eq(schema.cronJobs.id, id))
    .returning();
  if (!updated) return updated;
  applyRuntimeSchedule(registry, updated.name, cronExpression, logger);
  return updated;
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
