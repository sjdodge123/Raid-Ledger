import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PLUGIN_EVENTS } from '../plugins/plugin-host/plugin-manifest.interface';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  EXTENSION_POINTS,
  type CronRegistrar,
} from '../plugins/plugin-host/extension-points';
import * as schema from '../drizzle/schema';
import {
  CORE_JOB_METADATA,
  FLUSH_INTERVAL_MS,
  NOOP_LIVENESS_INTERVAL_MS,
  PRUNE_EVERY_N_EXECUTIONS,
} from './cron-job.constants';
import {
  computeNextRun,
  upsertJob,
  pruneExecutions,
  recordSkipped,
  recordCompleted,
  recordFailed,
  recordNoOp,
  shouldUpdateLiveness,
  extractRegistryJobMeta,
  flushPendingUpdates,
  recordSkippedTrigger,
} from './cron-job.helpers';
import {
  getCronJobSafe,
  setPaused,
  syncOnePluginRegistrar,
  getExecutionHistory,
  updateJobSchedule,
} from './cron-job.admin-helpers';

type CronJobRow = typeof schema.cronJobs.$inferSelect;

/**
 * CronJobService — registry and execution tracking for all cron jobs (ROK-310).
 */
@Injectable()
export class CronJobService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CronJobService.name);
  private readonly executionCounts = new Map<number, number>();
  private readonly jobCache = new Map<string, CronJobRow>();
  private readonly pendingLastRunUpdates = new Map<
    number,
    { lastRunAt: Date; cronExpression: string }
  >();
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Optional() private readonly pluginRegistry?: PluginRegistryService,
  ) {}

  onApplicationBootstrap() {
    setTimeout(() => {
      this.syncJobs().catch((err) =>
        this.logger.error(`Failed to sync cron jobs: ${err}`),
      );
    }, 2_000);
    this.flushInterval = setInterval(() => {
      this.flushLastRunUpdates().catch((err) =>
        this.logger.error(`Failed to flush last_run_at updates: ${err}`),
      );
    }, FLUSH_INTERVAL_MS);
  }

  async onModuleDestroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flushLastRunUpdates();
  }

  @OnEvent(PLUGIN_EVENTS.ACTIVATED)
  handlePluginActivated(): void {
    setTimeout(() => {
      this.syncJobs().catch((err) =>
        this.logger.error(
          `Failed to sync cron jobs after plugin activation: ${err}`,
        ),
      );
    }, 1_000);
  }

  /** Sync all registered cron jobs into the DB. */
  async syncJobs(): Promise<void> {
    const syncedNames = new Set<string>();
    await this.syncRegistryJobs(syncedNames);
    await this.syncPluginJobs(syncedNames);
    this.logger.log(`Cron job sync complete (${syncedNames.size} total)`);
    await this.refreshJobCache();
  }

  /** Sync jobs from SchedulerRegistry. */
  private async syncRegistryJobs(syncedNames: Set<string>): Promise<void> {
    const jobs = this.schedulerRegistry.getCronJobs();
    this.logger.log(`Syncing ${jobs.size} cron jobs from SchedulerRegistry`);
    for (const [name, job] of jobs) {
      const meta = extractRegistryJobMeta(name, job, this.logger);
      if (!meta) continue;
      await upsertJob(this.db, {
        name,
        ...meta,
        nextRunAt: computeNextRun(meta.cronExpression),
      });
      syncedNames.add(name);
    }
  }

  /** Sync jobs from plugin CronRegistrar adapters. */
  private async syncPluginJobs(syncedNames: Set<string>): Promise<void> {
    if (!this.pluginRegistry) return;
    const registrars =
      this.pluginRegistry.getAdaptersForExtensionPoint<CronRegistrar>(
        EXTENSION_POINTS.CRON_REGISTRAR,
      );
    for (const [slug, reg] of registrars) {
      await syncOnePluginRegistrar(
        this.db,
        slug,
        reg,
        syncedNames,
        this.logger,
      );
    }
  }

  /** Populate the in-memory job cache from DB. */
  private async refreshJobCache(): Promise<void> {
    const allJobs = await this.db.select().from(schema.cronJobs);
    this.jobCache.clear();
    for (const j of allJobs) this.jobCache.set(j.name, j);
  }

  // ─── Execution tracking ─────────────────────────────────────────

  /** Execute a cron handler with tracking. */
  async executeWithTracking(
    jobName: string,
    fn: () => Promise<void | boolean>,
  ): Promise<void> {
    const job = await this.resolveJob(jobName);
    if (!job) {
      await fn();
      return;
    }
    if (job.paused) {
      await recordSkipped(this.db, job, jobName);
      return;
    }
    await this.runTracked(job, jobName, fn);
  }

  /** Resolve a job from cache or DB. */
  private async resolveJob(jobName: string): Promise<CronJobRow | null> {
    const cached = this.jobCache.get(jobName);
    if (cached) return cached;
    const [row] = await this.db
      .select()
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.name, jobName))
      .limit(1);
    if (row) this.jobCache.set(jobName, row);
    return row ?? null;
  }

  /** Run tracked execution with timing, recording, and pruning. */
  private async runTracked(
    job: CronJobRow,
    jobName: string,
    fn: () => Promise<void | boolean>,
  ): Promise<void> {
    const startedAt = new Date();
    let didInsertRow = false;
    try {
      const result = await fn();
      const finishedAt = new Date();
      if (result === false) {
        recordNoOp(jobName, startedAt, finishedAt);
        this.queueLivenessIfStale(job);
      } else {
        await recordCompleted(this.db, job, jobName, startedAt, finishedAt);
        didInsertRow = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordFailed(
        this.db,
        job,
        jobName,
        startedAt,
        new Date(),
        msg,
        this.logger,
      );
      didInsertRow = true;
    } finally {
      if (didInsertRow) await this.maybePrune(job, jobName);
    }
  }

  /** Queue a liveness heartbeat if enough time has elapsed since last update. */
  private queueLivenessIfStale(job: CronJobRow): void {
    if (!shouldUpdateLiveness(job.lastRunAt, NOOP_LIVENESS_INTERVAL_MS)) return;
    const now = new Date();
    this.pendingLastRunUpdates.set(job.id, {
      lastRunAt: now,
      cronExpression: job.cronExpression,
    });
    job.lastRunAt = now;
  }

  /** Prune old executions periodically. */
  private async maybePrune(job: CronJobRow, jobName: string): Promise<void> {
    const count = (this.executionCounts.get(job.id) ?? 0) + 1;
    this.executionCounts.set(job.id, count);
    if (count >= PRUNE_EVERY_N_EXECUTIONS) {
      this.executionCounts.set(job.id, 0);
      await pruneExecutions(this.db, job.id).catch((err) =>
        this.logger.warn(`Failed to prune executions for ${jobName}: ${err}`),
      );
    }
  }

  // ─── Admin API methods ──────────────────────────────────────────

  /**
   * List all registered cron jobs, decorated with `usesAi` from
   * CORE_JOB_METADATA so the admin panel can badge + filter AI-backed
   * jobs without another round-trip.
   */
  async listJobs() {
    const rows = await this.db
      .select()
      .from(schema.cronJobs)
      .orderBy(schema.cronJobs.name);
    return rows.map((row) => ({
      ...row,
      usesAi: CORE_JOB_METADATA[row.name]?.usesAi ?? false,
    }));
  }

  /** Manually trigger a cron job by its DB id. */
  async triggerJob(id: number): Promise<CronJobRow | null> {
    const [job] = await this.db
      .select()
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.id, id))
      .limit(1);
    if (!job) return null;
    await this.fireTrigger(job);
    const [updated] = await this.db
      .select()
      .from(schema.cronJobs)
      .where(eq(schema.cronJobs.id, id))
      .limit(1);
    return updated ?? null;
  }

  /** Fire a triggered job (plugin or core). */
  private async fireTrigger(job: CronJobRow): Promise<void> {
    const cronJob = getCronJobSafe(this.schedulerRegistry, job.name);
    if (!cronJob) {
      await recordSkippedTrigger(this.db, job, this.logger);
      return;
    }
    this.logger.log(`Manually triggering cron job: ${job.name}`);
    const handler = this.findPluginHandler(job);
    if (handler) {
      await this.executeWithTracking(job.name, handler);
    } else {
      void cronJob.fireOnTick();
    }
  }

  /** Find a plugin handler for a job, if applicable. */
  private findPluginHandler(job: CronJobRow): (() => Promise<void>) | null {
    if (job.source !== 'plugin' || !job.pluginSlug || !this.pluginRegistry) {
      return null;
    }
    const reg = this.pluginRegistry.getAdapter<CronRegistrar>(
      EXTENSION_POINTS.CRON_REGISTRAR,
      job.pluginSlug,
    );
    const def = reg
      ?.getCronJobs()
      .find((j) => `${job.pluginSlug}:${j.name}` === job.name);
    return def ? async () => def.handler() : null;
  }

  /** Get execution history for a specific job. */
  async getExecutionHistory(jobId: number, limit = 50) {
    return getExecutionHistory(this.db, jobId, limit);
  }

  /** Pause a cron job. Future executions will log "skipped". */
  async pauseJob(id: number) {
    const updated = await setPaused(this.db, id, true);
    if (updated) this.jobCache.set(updated.name, updated);
    return updated;
  }

  /** Resume a paused cron job. */
  async resumeJob(id: number) {
    const updated = await setPaused(this.db, id, false);
    if (updated) this.jobCache.set(updated.name, updated);
    return updated;
  }

  /** Update schedule (cron expression) for a job. */
  async updateSchedule(id: number, cronExpression: string) {
    const updated = await updateJobSchedule(
      this.db,
      this.schedulerRegistry,
      id,
      cronExpression,
      this.logger,
    );
    if (updated) this.jobCache.set(updated.name, updated);
    return updated;
  }

  /** Flush pending last_run_at updates to DB. */
  async flushLastRunUpdates(): Promise<void> {
    return flushPendingUpdates(
      this.db,
      this.pendingLastRunUpdates,
      this.logger,
    );
  }
}
