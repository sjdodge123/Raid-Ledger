import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { perfLog } from '../common/perf-logger';
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

/** Run retention cleanup every N executions per job (reduces DB overhead) */
const PRUNE_EVERY_N_EXECUTIONS = 50;

/** How often (ms) to flush cached last_run_at updates to the DB */
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Human-readable descriptions for the core @Cron jobs.
 * Keys match the NestJS SchedulerRegistry names (class.method format).
 */
/**
 * Valid categories for cron jobs. Must match the `category` column values.
 */
type CronCategory =
  | 'Data Sync'
  | 'Notifications'
  | 'Events'
  | 'Maintenance'
  | 'Monitoring'
  | 'Other';

const CORE_JOB_METADATA: Record<
  string,
  { description: string; category: CronCategory }
> = {
  IgdbService_handleScheduledSync: {
    description: 'Syncs game data from IGDB every 6 hours',
    category: 'Data Sync',
  },
  EventReminderService_handleReminders: {
    description:
      'Checks for events within reminder windows and sends DM reminders every 60 seconds',
    category: 'Notifications',
  },
  EventReminderService_handleDayOfReminders: {
    description:
      'Sends day-of reminder DMs for events starting today every 60 seconds',
    category: 'Notifications',
  },
  RelayService_handleHeartbeat: {
    description: 'Sends heartbeat to the Raid Ledger relay hub every hour',
    category: 'Monitoring',
  },
  VersionCheckService_handleCron: {
    description: 'Checks GitHub for new Raid Ledger releases daily',
    category: 'Monitoring',
  },
  EmbedSchedulerService_handleScheduledEmbeds: {
    description:
      'Posts deferred Discord embeds for future series events approaching their lead-time window every 15 minutes',
    category: 'Notifications',
  },
  SessionCleanupService_cleanupExpiredSessions: {
    description: 'Deletes expired sessions daily at 3 AM',
    category: 'Maintenance',
  },
  NotificationService_cleanupExpiredNotifications: {
    description: 'Deletes expired notifications daily at 4 AM',
    category: 'Maintenance',
  },
  GameActivityService_sweepStaleSessions: {
    description:
      'Closes game activity sessions older than 24h every 15 minutes',
    category: 'Maintenance',
  },
  GameActivityService_dailyRollup: {
    description:
      'Aggregates closed game sessions into daily/weekly/monthly rollups at 5 AM',
    category: 'Data Sync',
  },
  BackupService_dailyBackup: {
    description:
      'Creates a pg_dump backup and rotates backups older than 30 days',
    category: 'Maintenance',
  },
  ScheduledEventService_startScheduledEvents: {
    description:
      'Auto-starts Discord scheduled events when their start time arrives every 30 seconds',
    category: 'Events',
  },
  EventAutoExtendService_checkExtensions: {
    description:
      'Auto-extends scheduled events when voice channel activity persists past the end time every 60 seconds',
    category: 'Events',
  },
  VoiceAttendanceService_classifyCompletedEvents: {
    description:
      'Classifies attendance for completed voice events every 60 seconds',
    category: 'Events',
  },
  LiveNoShowService_checkNoShows: {
    description:
      'Detects no-show attendees during live events and sends reminder DMs (5 min) and creator escalation (15 min) every 60 seconds',
    category: 'Notifications',
  },
  PostEventReminderService_handlePostEventReminders: {
    description:
      'Sends post-event feedback reminders after events end every 60 seconds',
    category: 'Notifications',
  },
  RecruitmentReminderService_checkAndSendReminders: {
    description:
      'DMs unsigned game followers about upcoming events every 15 minutes',
    category: 'Notifications',
  },
  SteamSyncProcessor_scheduledSync: {
    description: 'Syncs Steam library data for all linked users daily at 4 AM',
    category: 'Data Sync',
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
export class CronJobService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CronJobService.name);

  /** In-memory counter per cronJobId to decide when to run retention cleanup */
  private readonly executionCounts = new Map<number, number>();

  /** In-memory cache of job rows keyed by name (avoids SELECT per tick) */
  private readonly jobCache = new Map<
    string,
    typeof schema.cronJobs.$inferSelect
  >();

  /** Pending last_run_at updates keyed by job ID → { lastRunAt, cronExpression } */
  private readonly pendingLastRunUpdates = new Map<
    number,
    { lastRunAt: Date; cronExpression: string }
  >();

  /** Interval handle for periodic flush of last_run_at */
  private flushInterval: ReturnType<typeof setInterval> | null = null;

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

    // Start periodic flush of cached last_run_at updates
    this.flushInterval = setInterval(() => {
      this.flushLastRunUpdates().catch((err) =>
        this.logger.error(`Failed to flush last_run_at updates: ${err}`),
      );
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Clean up on module destroy — flush pending updates and clear interval.
   */
  async onModuleDestroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    // Flush any pending updates before shutdown
    await this.flushLastRunUpdates();
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

      // Reject jobs with auto-generated UUID names — every @Cron must have an explicit name
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name)) {
        this.logger.error(
          `Skipping cron job with auto-generated name "${name}". ` +
            'Add { name: "ClassName_methodName" } to the @Cron decorator.',
        );
        continue;
      }

      // Warn if a core job is missing metadata (description + category)
      const meta = CORE_JOB_METADATA[name];
      if (!isPlugin && !meta) {
        this.logger.warn(
          `Core cron job "${name}" is missing CORE_JOB_METADATA entry. ` +
            'Add a description and category to cron-job.service.ts.',
        );
      }

      const cronExpression =
        typeof job.cronTime === 'object' && 'source' in job.cronTime
          ? String(job.cronTime.source)
          : String(job.cronTime);

      const nextRunAt = this.computeNextRun(cronExpression);

      await this.upsertJob(
        name,
        source,
        pluginSlug,
        cronExpression,
        meta?.description ?? null,
        meta?.category ?? (isPlugin ? 'Plugin' : 'Other'),
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
                'Plugin',
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

    // Populate the in-memory job cache from DB
    const allJobs = await this.db.select().from(schema.cronJobs);
    this.jobCache.clear();
    for (const j of allJobs) {
      this.jobCache.set(j.name, j);
    }
  }

  /** Upsert a single cron job into the DB */
  private async upsertJob(
    name: string,
    source: string,
    pluginSlug: string | null,
    cronExpression: string,
    description: string | null,
    category: string,
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
        category,
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
          category,
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
   * - Periodically prunes old execution history (every Nth execution)
   *
   * Performance optimizations (ROK-663):
   * - Job rows are cached in memory (no SELECT per tick)
   * - Handler can return `false` to signal a no-op run, which skips the
   *   INSERT into execution history and defers the last_run_at UPDATE
   * - last_run_at updates for no-op runs are batched and flushed every 5 min
   *
   * @param jobName - The unique job name (must match cron_jobs.name)
   * @param fn - The async handler. Return `false` to signal no work was done
   *             (skips execution record). Return void/true for normal tracking.
   */
  async executeWithTracking(
    jobName: string,
    fn: () => Promise<void | boolean>,
  ): Promise<void> {
    // Look up job from in-memory cache first, fall back to DB
    let job = this.jobCache.get(jobName) ?? null;
    if (!job) {
      const [row] = await this.db
        .select()
        .from(schema.cronJobs)
        .where(eq(schema.cronJobs.name, jobName))
        .limit(1);
      if (row) {
        this.jobCache.set(jobName, row);
        job = row;
      }
    }

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
      perfLog('CRON', jobName, 0, { status: 'skipped' });
      return;
    }

    // Execute and track
    const startedAt = new Date();
    try {
      const result = await fn();
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      // If the handler explicitly returned false, this was a no-op run.
      // Skip the execution INSERT and defer the last_run_at UPDATE.
      const isNoOp = result === false;

      if (isNoOp) {
        // Defer last_run_at update to the periodic flush
        this.pendingLastRunUpdates.set(job.id, {
          lastRunAt: finishedAt,
          cronExpression: job.cronExpression,
        });
        perfLog('CRON', jobName, durationMs, { status: 'no-op' });
      } else {
        await this.db.insert(schema.cronJobExecutions).values({
          cronJobId: job.id,
          status: 'completed',
          startedAt,
          finishedAt,
          durationMs,
        });
        perfLog('CRON', jobName, durationMs, { status: 'completed' });

        // Update last_run_at + next_run_at immediately for meaningful runs
        const nextRunAt = this.computeNextRun(job.cronExpression);
        await this.db
          .update(schema.cronJobs)
          .set({ lastRunAt: finishedAt, nextRunAt, updatedAt: new Date() })
          .where(eq(schema.cronJobs.id, job.id));

        // Update cache
        job.lastRunAt = finishedAt;
        if (nextRunAt) job.nextRunAt = nextRunAt;
      }
    } catch (error) {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Always record failed executions (important for debugging)
      await this.db.insert(schema.cronJobExecutions).values({
        cronJobId: job.id,
        status: 'failed',
        startedAt,
        finishedAt,
        durationMs,
        error: errorMessage,
      });
      perfLog('CRON', jobName, durationMs, { status: 'failed' });

      // Update last_run_at + next_run_at even on failure
      const nextRunAt = this.computeNextRun(job.cronExpression);
      await this.db
        .update(schema.cronJobs)
        .set({ lastRunAt: finishedAt, nextRunAt, updatedAt: new Date() })
        .where(eq(schema.cronJobs.id, job.id));

      // Update cache
      job.lastRunAt = finishedAt;
      if (nextRunAt) job.nextRunAt = nextRunAt;

      // Log the error but do NOT re-throw — executeWithTracking is a
      // fire-and-forget wrapper; the calling @Cron handler already had
      // its own error handling before this wrapper was added.
      this.logger.error(`Cron job "${jobName}" failed: ${errorMessage}`);
    } finally {
      // Prune old executions periodically (every Nth execution, not every tick)
      const count = (this.executionCounts.get(job.id) ?? 0) + 1;
      this.executionCounts.set(job.id, count);

      if (count >= PRUNE_EVERY_N_EXECUTIONS) {
        this.executionCounts.set(job.id, 0);
        await this.pruneExecutions(job.id).catch((err) =>
          this.logger.warn(`Failed to prune executions for ${jobName}: ${err}`),
        );
      }
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
    if (updated) this.jobCache.set(updated.name, updated);
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
    if (updated) this.jobCache.set(updated.name, updated);
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
    this.jobCache.set(updated.name, updated);

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
   * Flush all pending last_run_at updates to the DB in a single batch.
   * Called periodically (every 5 min) and on shutdown.
   */
  async flushLastRunUpdates(): Promise<void> {
    if (this.pendingLastRunUpdates.size === 0) return;

    // Snapshot and clear to avoid concurrent modification
    const updates = new Map(this.pendingLastRunUpdates);
    this.pendingLastRunUpdates.clear();

    const now = new Date();
    for (const [jobId, { lastRunAt, cronExpression }] of updates) {
      try {
        const nextRunAt = this.computeNextRun(cronExpression);
        await this.db
          .update(schema.cronJobs)
          .set({ lastRunAt, nextRunAt, updatedAt: now })
          .where(eq(schema.cronJobs.id, jobId));
      } catch (err) {
        this.logger.warn(
          `Failed to flush last_run_at for job ${jobId}: ${err}`,
        );
      }
    }

    this.logger.debug(`Flushed last_run_at for ${updates.size} cron job(s)`);
  }

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
