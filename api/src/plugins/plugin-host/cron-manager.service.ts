import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PluginRegistryService } from './plugin-registry.service';
import { PLUGIN_EVENTS } from './plugin-manifest.interface';
import { EXTENSION_POINTS } from './extension-points';
import type { CronRegistrar } from './extension-points';

@Injectable()
export class CronManagerService {
  private readonly logger = new Logger(CronManagerService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  @OnEvent(PLUGIN_EVENTS.ACTIVATED)
  handlePluginActivated(payload: { slug: string }): void {
    const adapter = this.pluginRegistry.getAdapter<CronRegistrar>(
      EXTENSION_POINTS.CRON_REGISTRAR,
      payload.slug,
    );
    if (!adapter) return;

    const jobs = adapter.getCronJobs();
    for (const job of jobs) {
      const jobName = `${payload.slug}:${job.name}`;
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
