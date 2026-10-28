import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Job, Queue } from 'bullmq';
import { CronJobService } from '../../../cron-jobs/cron-job.service';
import { QueueHealthService } from '../../../queue/queue-health.service';
import { SettingsService } from '../../../settings/settings.service';
import {
  STEAM_STATS_JOB_RETRY,
  STEAM_APP_STATS_QUEUE,
  type SteamAppStatsJobData,
} from './steam-stats.constants';
import {
  SteamStatsRefreshService,
  type SteamStatsRunSummary,
} from './steam-stats-refresh.service';

/** Also written as a literal in `@Cron` below — the cron guard scans for it. */
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
  private readonly logger = new Logger(SteamAppStatsProcessor.name);

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

  /**
   * Runs one queued refresh. A failure is logged (error name only — never a
   * message that could carry the key or a SteamID) and rethrown so BullMQ
   * retries it with the job's backoff.
   */
  async process(job: Job<SteamAppStatsJobData>): Promise<SteamStatsRunSummary> {
    const data = job.data;
    try {
      return data.trigger === 'link'
        ? await this.refresh.refreshUser(data.userId)
        : await this.refresh.refreshAll();
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(
        `Steam stats ${data.trigger} job ${job.id ?? '?'} failed (${reason}); BullMQ retries`,
      );
      throw err;
    }
  }

  /** Enqueues the nightly run; no Steam key = idle tick, no execution row. */
  @Cron('0 30 4 * * *', { name: 'SteamAppStatsProcessor_scheduledRefresh' })
  async scheduledRefresh(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, async () => {
      if (!(await this.settings.isSteamConfigured())) return false;
      const data: SteamAppStatsJobData = { trigger: 'scheduled' };
      await this.queue.add('nightly', data, {
        ...STEAM_STATS_JOB_RETRY,
        removeOnComplete: true,
      });
      return true;
    });
  }
}
