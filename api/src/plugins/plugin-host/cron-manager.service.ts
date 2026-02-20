import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PluginRegistryService } from './plugin-registry.service';
import { PLUGIN_EVENTS } from './plugin-manifest.interface';
import { EXTENSION_POINTS } from './extension-points';
import type { CronRegistrar } from './extension-points';

@Injectable()
export class CronManagerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CronManagerService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly pluginRegistry: PluginRegistryService,
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
          onTick: job.handler,
          start: true,
        });
        this.schedulerRegistry.addCronJob(jobName, cronJob);
        this.logger.log(`Registered cron job: ${jobName}`);
      } catch (err) {
        this.logger.error(`Failed to register cron job ${jobName}: ${err}`);
      }
    }
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
