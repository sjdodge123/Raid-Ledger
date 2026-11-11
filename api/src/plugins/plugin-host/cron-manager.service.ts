import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PluginRegistryService } from './plugin-registry.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { PLUGIN_EVENTS } from './plugin-manifest.interface';
import { EXTENSION_POINTS } from './extension-points';
import type { CronRegistrar } from './extension-points';

@Injectable()
export class CronManagerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CronManagerService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly cronJobService: CronJobService,
  ) {}

  /**
   * On startup, register cron jobs for all already-active plugins.
   * The ACTIVATED event is only emitted when a plugin is toggled on at
   * runtime, so plugins that are already active at boot never fire it.
   */
  onApplicationBootstrap(): void {
    const registrars =
      this.pluginRegistry.getAdaptersForExtensionPoint<CronRegistrar>(
        EXTENSION_POINTS.CRON_REGISTRAR,
      );

    for (const [slug, registrar] of registrars) {
      this.registerJobsForPlugin(slug, registrar);
    }
  }

  @OnEvent(PLUGIN_EVENTS.ACTIVATED)
  handlePluginActivated(payload: { slug: string }): void {
    const adapter = this.pluginRegistry.getAdapter<CronRegistrar>(
      EXTENSION_POINTS.CRON_REGISTRAR,
      payload.slug,
    );
    if (!adapter) return;

    this.registerJobsForPlugin(payload.slug, adapter);
  }

  /**
   * `PluginRegistryService.install()` inserts the row already active and emits
   * only INSTALLED (never ACTIVATED), so a runtime install must register the
   * plugin's jobs here too — otherwise they wait for the next API restart.
   */
  @OnEvent(PLUGIN_EVENTS.INSTALLED)
  handlePluginInstalled(payload: { slug: string }): void {
    this.handlePluginActivated(payload);
  }

  /**
   * Register cron jobs from a CronRegistrar adapter into the SchedulerRegistry.
   * Skips jobs that are already registered (idempotent).
   */
  private registerJobsForPlugin(slug: string, adapter: CronRegistrar): void {
    const jobs = adapter.getCronJobs();
    for (const job of jobs) {
      const jobName = `${slug}:${job.name}`;

      // Skip if already registered (e.g., bootstrap ran before ACTIVATED event)
      try {
        this.schedulerRegistry.getCronJob(jobName);
        this.logger.debug(`Cron job already registered: ${jobName}`);
        continue;
      } catch {
        // Not registered yet — proceed to create it
      }

      try {
        const cronJob = CronJob.from({
          cronTime: job.cronExpression,
          onTick: () => this.runTracked(jobName, job.handler),
          start: true,
        });
        this.schedulerRegistry.addCronJob(jobName, cronJob);
        this.logger.log(`Registered cron job: ${jobName}`);
      } catch (err) {
        this.logger.error(`Failed to register cron job ${jobName}: ${err}`);
      }
    }
  }

  /**
   * Run one scheduled tick through the shared job tracker (ROK-2166), so the
   * admin Jobs page's Pause applies and the run leaves an execution row —
   * the same path "Run now" takes. A tracker failure never stops the job: if
   * the row lookup fails or there is no row, the tracker runs the handler
   * untracked (one warning); a paused row is a skip; a handler error or a
   * failed history write after the handler ran is logged, never re-run.
   * This catch only keeps an error that still escapes (for example an
   * untracked handler throwing) from becoming an unhandled rejection.
   * Overlap behaviour is unchanged: ticks are not serialised.
   */
  private runTracked(
    jobName: string,
    handler: () => void | Promise<void>,
  ): void {
    this.cronJobService
      .executeWithTracking(jobName, async () => handler())
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Cron job ${jobName} tick failed: ${msg}`);
      });
  }

  @OnEvent(PLUGIN_EVENTS.DEACTIVATED)
  handlePluginDeactivated(payload: { slug: string }): void {
    const prefix = `${payload.slug}:`;
    const allJobs = this.schedulerRegistry.getCronJobs();

    for (const [name] of allJobs) {
      if (name.startsWith(prefix)) {
        try {
          this.schedulerRegistry.deleteCronJob(name);
          this.logger.log(`Removed cron job: ${name}`);
        } catch (err) {
          this.logger.warn(`Failed to remove cron job ${name}: ${err}`);
        }
      }
    }
  }
}
