import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { CronTime } from 'cron';
import { eq, desc, sql, and, lt } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PLUGIN_EVENTS } from '../plugins/plugin-host/plugin-manifest.interface';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  EXTENSION_POINTS,
  type CronRegistrar,
} from '../plugins/plugin-host/extension-points';
import * as schema from '../drizzle/schema';

/** Maximum execution history rows kept per job */
const MAX_EXECUTIONS_PER_JOB = 50;

/**
 * Human-readable descriptions for the core @Cron jobs.
 * Keys match the NestJS SchedulerRegistry names (class.method format).
 */
const CORE_JOB_METADATA: Record<string, { description: string }> = {
  IgdbService_handleScheduledSync: {
    description: 'Syncs game data from IGDB every 6 hours',
  },
  EventReminderService_handleReminders: {
    description:
      'Checks for events within reminder windows and sends DM reminders every 60 seconds (ROK-126)',
  },
  EventReminderService_handleDayOfReminders: {
    description: 'Sends day-of event reminders every 15 minutes',
  },
  RelayService_handleHeartbeat: {
    description: 'Sends heartbeat to the Raid Ledger relay hub every hour',
  },
  VersionCheckService_handleCron: {
    description: 'Checks GitHub for new Raid Ledger releases daily',
  },
  SessionCleanupService_cleanupExpiredSessions: {
    description: 'Deletes expired sessions daily at 3 AM',
  },
  NotificationService_cleanupExpiredNotifications: {
    description: 'Deletes expired notifications daily at 4 AM',
  },
};

/**
 * CronJobService — registry and execution tracking for all cron jobs (ROK-310).
 *
 * Responsibilities:
 * - Auto-syncs cron jobs from SchedulerRegistry into DB on startup
 * - Also scans plugin CronRegistrar adapters for plugin-provided jobs
 * - Re-syncs when plugins activate (to pick up plugin cron jobs)
 * - Provides pause/resume toggle per job
 * - Wraps cron handler execution with timing, error capture, and pruning
 * - Provides read APIs for admin UI
 */
@Injectable()
export class CronJobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CronJobService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Optional() private readonly pluginRegistry?: PluginRegistryService,
  ) {}

  /**
   * After the entire application has bootstrapped (all modules initialized,
   * all @Cron decorators registered), sync jobs into the DB.
   */
  onApplicationBootstrap() {
    // Small delay to ensure SchedulerRegistry is fully populated
    setTimeout(() => {
      this.syncJobs().catch((err) =>
        this.logger.error(`Failed to sync cron jobs: ${err}`),
      );
    }, 2_000);
  }

  /**
   * Re-sync when a plugin activates — plugin cron jobs are registered
   * asynchronously via CronManagerService after the initial bootstrap sync.
   */
  @OnEvent(PLUGIN_EVENTS.ACTIVATED)
  handlePluginActivated(): void {
    // Delay slightly to let CronManagerService register the jobs first
    setTimeout(() => {
      this.syncJobs().catch((err) =>
        this.logger.error(
          `Failed to sync cron jobs after plugin activation: ${err}`,
        ),
      );
    }, 1_000);
  }

  /**
   * Sync all registered cron jobs into the DB.
   * Sources:
   * 1. SchedulerRegistry — core @Cron decorated methods and plugin jobs added via CronManagerService
   * 2. Plugin CronRegistrar adapters — for plugins whose jobs aren't in the registry yet
   */
  async syncJobs(): Promise<void> {
    const syncedNames = new Set<string>();

    // 1. Sync from SchedulerRegistry (core + already-activated plugin jobs)
    const registeredJobs = this.schedulerRegistry.getCronJobs();
    this.logger.log(
      `Syncing ${registeredJobs.size} cron jobs from SchedulerRegistry`,
    );

    for (const [name, job] of registeredJobs) {
      const isPlugin = name.includes(':') && !name.startsWith('core:');
      const source = isPlugin ? 'plugin' : 'core';
      const pluginSlug = isPlugin ? name.split(':')[0] : null;

      const cronExpression =
        typeof job.cronTime === 'object' && 'source' in job.cronTime
          ? String(job.cronTime.source)
          : String(job.cronTime);

      const meta = CORE_JOB_METADATA[name];
      const nextRunAt = this.computeNextRun(cronExpression);

      await this.upsertJob(
        name,
        source,
        pluginSlug,
        cronExpression,
        meta?.description ?? null,
        nextRunAt,
      );
      syncedNames.add(name);
    }

    // 2. Scan plugin CronRegistrar adapters for jobs not yet in SchedulerRegistry
    if (this.pluginRegistry) {
      const registrars =
        this.pluginRegistry.getAdaptersForExtensionPoint<CronRegistrar>(
          EXTENSION_POINTS.CRON_REGISTRAR,
        );
      for (const [gameSlug, registrar] of registrars) {
        try {
          const pluginJobs = registrar.getCronJobs();
          for (const pJob of pluginJobs) {
            const jobName = `${gameSlug}:${pJob.name}`;
            if (!syncedNames.has(jobName)) {
              const nextRunAt = this.computeNextRun(pJob.cronExpression);
              await this.upsertJob(
                jobName,
                'plugin',
                gameSlug,
                pJob.cronExpression,
                null,
                nextRunAt,
              );
              syncedNames.add(jobName);
              this.logger.log(`Synced plugin cron job: ${jobName}`);
            }
          }
        } catch (err) {
          this.logger.error(
            `Failed to sync plugin cron registrar for ${gameSlug}: ${err}`,
          );
        }
      }
    }

    this.logger.log(`Cron job sync complete (${syncedNames.size} total)`);
  }

  /** Upsert a single cron job into the DB */
  private async upsertJob(
    name: string,
    source: string,
    pluginSlug: string | null,
    cronExpression: string,
    description: string | null,
    nextRunAt: Date | null = null,
  ): Promise<void> {
    await this.db
      .insert(schema.cronJobs)
      .values({
        name,
        source,
        pluginSlug,
        cronExpression,
        description,
        paused: false,
        nextRunAt,
      })
      .onConflictDoUpdate({
        target: schema.cronJobs.name,
        set: {
          cronExpression,
          source,
          pluginSlug,
          description: description ?? sql`${schema.cronJobs.description}`,
          nextRunAt,
          updatedAt: new Date(),
        },
      });
  }

  // ─── Execution tracking ─────────────────────────────────────────

  /**
   * Execute a cron handler with tracking. Call this inside every @Cron method.
   *
   * - Checks if job is paused → logs "skipped" execution
   * - Times execution and records "completed" or "failed"
   * - Prunes old execution history beyond MAX_EXECUTIONS_PER_JOB
   *
   * @param jobName - The unique job name (must match cron_jobs.name)
   * @param fn - The async handler function to execute
   */
  async executeWithTracking(
    jobName: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    // Find the job row
    const [job] = await this.db
      .select()
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.name, jobName))
      .limit(1);

    if (!job) {
      // Job not yet synced — just run it directly
      await fn();
      return;
    }

    // Check if paused
    if (job.paused) {
      await this.db.insert(schema.cronJobExecutions).values({
        cronJobId: job.id,
        status: 'skipped',
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 0,
      });
      return;
    }

    // Execute and track
    const startedAt = new Date();
    try {
      await fn();
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      await this.db.insert(schema.cronJobExecutions).values({
        cronJobId: job.id,
        status: 'completed',
        startedAt,
        finishedAt,
        durationMs,
      });

      // Update last_run_at + next_run_at
      const nextRunAt = this.computeNextRun(job.cronExpression);
      await this.db
        .update(schema.cronJobs)
        .set({ lastRunAt: finishedAt, nextRunAt, updatedAt: new Date() })
        .where(eq(schema.cronJobs.id, job.id));
    } catch (error) {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.db.insert(schema.cronJobExecutions).values({
        cronJobId: job.id,
        status: 'failed',
        startedAt,
        finishedAt,
        durationMs,
        error: errorMessage,
      });

      // Update last_run_at + next_run_at even on failure
      const nextRunAt = this.computeNextRun(job.cronExpression);
      await this.db
        .update(schema.cronJobs)
        .set({ lastRunAt: finishedAt, nextRunAt, updatedAt: new Date() })
        .where(eq(schema.cronJobs.id, job.id));

      // Log the error but do NOT re-throw — executeWithTracking is a
      // fire-and-forget wrapper; the calling @Cron handler already had
      // its own error handling before this wrapper was added.
      this.logger.error(`Cron job "${jobName}" failed: ${errorMessage}`);
    } finally {
      // Prune old executions
      await this.pruneExecutions(job.id).catch((err) =>
        this.logger.warn(`Failed to prune executions for ${jobName}: ${err}`),
      );
    }
  }

  // ─── Admin API methods ──────────────────────────────────────────

  /**
   * List all registered cron jobs.
   */
  async listJobs() {
    return this.db.select().from(schema.cronJobs).orderBy(schema.cronJobs.name);
  }

  /**
   * Manually trigger a cron job by its DB id.
   * Looks up the job in SchedulerRegistry and fires it synchronously
   * with execution tracking.
   */
  async triggerJob(
    id: number,
  ): Promise<typeof schema.cronJobs.$inferSelect | null> {
    const [job] = await this.db
      .select()
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.id, id))
      .limit(1);

    if (!job) return null;

    // Find the CronJob in the registry
    let cronJob:
      | ReturnType<typeof this.schedulerRegistry.getCronJob>
      | undefined;
    try {
      cronJob = this.schedulerRegistry.getCronJob(job.name);
    } catch {
      // Job may be a plugin job not in the registry — nothing to fire
    }

    if (cronJob) {
      this.logger.log(`Manually triggering cron job: ${job.name}`);

      if (job.source === 'plugin' && job.pluginSlug && this.pluginRegistry) {
        // Plugin jobs — use executeWithTracking so the execution is recorded
        // in the DB. Look up the handler from the CronRegistrar adapter.
        const registrar = this.pluginRegistry.getAdapter<CronRegistrar>(
          EXTENSION_POINTS.CRON_REGISTRAR,
          job.pluginSlug,
        );
        const definition = registrar
          ?.getCronJobs()
          .find((j) => `${job.pluginSlug}:${j.name}` === job.name);

        if (definition) {
          await this.executeWithTracking(job.name, async () => {
            await definition.handler();
          });
        } else {
          // Adapter missing — fall back to fire-and-forget
          void cronJob.fireOnTick();
        }
      } else {
        // Built-in core job — fireOnTick is already tracked by the @Cron decorator
        void cronJob.fireOnTick();
      }
    } else {
      // Job exists in DB but not in SchedulerRegistry (e.g. unactivated plugin).
      // Record as "skipped" since the handler didn't actually execute.
      this.logger.warn(
        `Cron job "${job.name}" not in SchedulerRegistry — cannot trigger`,
      );
      await this.db.insert(schema.cronJobExecutions).values({
        cronJobId: job.id,
        status: 'skipped',
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 0,
        error: 'Job not in SchedulerRegistry — could not be triggered',
      });
    }

    // Return refreshed job
    const [updated] = await this.db
      .select()
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.id, id))
      .limit(1);

    return updated ?? null;
  }

  /**
   * Get execution history for a specific job.
   */
  async getExecutionHistory(jobId: number, limit = 50) {
    return this.db
      .select()
      .from(schema.cronJobExecutions)
      .where(eq(schema.cronJobExecutions.cronJobId, jobId))
      .orderBy(desc(schema.cronJobExecutions.startedAt))
      .limit(limit);
  }

  /**
   * Pause a cron job. Future executions will log "skipped".
   */
  async pauseJob(id: number) {
    const [updated] = await this.db
      .update(schema.cronJobs)
      .set({ paused: true, updatedAt: new Date() })
      .where(eq(schema.cronJobs.id, id))
      .returning();
    return updated;
  }

  /**
   * Resume a paused cron job.
   */
  async resumeJob(id: number) {
    const [updated] = await this.db
      .update(schema.cronJobs)
      .set({ paused: false, updatedAt: new Date() })
      .where(eq(schema.cronJobs.id, id))
      .returning();
    return updated;
  }

  /**
   * Update the schedule (cron expression) for a job.
   * Applies the change at runtime via SchedulerRegistry so it takes
   * effect immediately. Note: Core @Cron decorator schedules will
   * revert to their original expression on application restart.
   */
  async updateSchedule(id: number, cronExpression: string) {
    // H3: Validate cron expression before persisting
    try {
      new CronTime(cronExpression);
    } catch {
      throw new BadRequestException(
        `Invalid cron expression: "${cronExpression}"`,
      );
    }

    const nextRunAt = this.computeNextRun(cronExpression);
    const [updated] = await this.db
      .update(schema.cronJobs)
      .set({ cronExpression, nextRunAt, updatedAt: new Date() })
      .where(eq(schema.cronJobs.id, id))
      .returning();

    if (!updated) return updated;

    // Apply at runtime if the job exists in the SchedulerRegistry
    try {
      const job = this.schedulerRegistry.getCronJob(updated.name);
      void job.stop();
      job.setTime(new CronTime(cronExpression));
      job.start();
      this.logger.log(
        `Runtime schedule updated for "${updated.name}" → ${cronExpression}`,
      );
    } catch (err) {
      // Job might not be in the registry (e.g. plugin job that hasn't started)
      this.logger.warn(
        `Could not apply runtime schedule for "${updated.name}": ${err instanceof Error ? err.message : err}`,
      );
    }

    return updated;
  }

  // ─── Private helpers ────────────────────────────────────────────

  /**
   * Compute the next fire time from a cron expression. Returns null if
   * the expression is invalid or has no future fires.
   */
  private computeNextRun(cronExpression: string): Date | null {
    try {
      const ct = new CronTime(cronExpression);
      const next = ct.sendAt();
      // sendAt() returns a Luxon DateTime — convert to JS Date
      return next.toJSDate ? next.toJSDate() : new Date(next.toString());
    } catch {
      return null;
    }
  }

  /**
   * Prune execution history beyond MAX_EXECUTIONS_PER_JOB for a given job.
   */
  private async pruneExecutions(cronJobId: number): Promise<void> {
    // Find the Nth execution's ID to use as a cutoff
    const rows = await this.db
      .select({ id: schema.cronJobExecutions.id })
      .from(schema.cronJobExecutions)
      .where(eq(schema.cronJobExecutions.cronJobId, cronJobId))
      .orderBy(desc(schema.cronJobExecutions.startedAt))
      .limit(1)
      .offset(MAX_EXECUTIONS_PER_JOB);

    if (rows.length === 0) return; // Under the limit

    const cutoffId = rows[0].id;

    await this.db
      .delete(schema.cronJobExecutions)
      .where(
        and(
          eq(schema.cronJobExecutions.cronJobId, cronJobId),
          lt(schema.cronJobExecutions.id, cutoffId),
        ),
      );
  }
}
