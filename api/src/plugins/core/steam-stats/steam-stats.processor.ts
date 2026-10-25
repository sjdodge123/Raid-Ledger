import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Job, Queue } from 'bullmq';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { QueueHealthService } from '../../../queue/queue-health.service';
import { SettingsService } from '../../../settings/settings.service';
import {
  RATE_LIMIT_BACKOFF_MS,
  STEAM_APP_STATS_QUEUE,
  type SteamAppStatsJobData,
} from './steam-stats.constants';
import {
  SteamStatsRefreshService,
  type SteamStatsRunSummary,
} from './steam-stats-refresh.service';

const JOB_NAME = 'SteamAppStatsProcessor_scheduledRefresh';

/**
 * ROK-1953 D5 — the nightly Steam achievements refresh (04:30, after the
 * 04:00 library sync) and the on-link refresh (D6), on their own queue.
 * A 429 throws out of `process`, so BullMQ retries with a 10-minute
 * exponential backoff; the oldest-first order makes a retry resume with
 * the least-fresh users. Declared under `HUB_PLUGIN_MANIFESTS.core`.
 */
@Processor(STEAM_APP_STATS_QUEUE)
export class SteamAppStatsProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly refresh: SteamStatsRefreshService,
    private readonly settings: SettingsService,
    private readonly cronJobService: CronJobService,
    private readonly queueHealth: QueueHealthService,
    @InjectQueue(STEAM_APP_STATS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  onModuleInit(): void {
    this.queueHealth.register(this.queue);
  }

  /** Runs one queued refresh. */
  async process(job: Job<SteamAppStatsJobData>): Promise<SteamStatsRunSummary> {
    const data = job.data;
    return data.trigger === 'link'
      ? this.refresh.refreshUser(data.userId)
      : this.refresh.refreshAll();
  }

  /** Enqueues the nightly run; no Steam key = idle tick, no execution row. */
  @Cron('0 30 4 * * *', { name: 'SteamAppStatsProcessor_scheduledRefresh' })
  async scheduledRefresh(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, async () => {
      if (!(await this.settings.isSteamConfigured())) return false;
      const data: SteamAppStatsJobData = { trigger: 'scheduled' };
      await this.queue.add('nightly', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: RATE_LIMIT_BACKOFF_MS },
        removeOnComplete: true,
      });
      return true;
    });
  }
}
