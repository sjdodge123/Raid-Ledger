import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SteamService } from './steam.service';
import { SteamWishlistService } from './steam-wishlist.service';
import { SettingsService } from '../settings/settings.service';
import { QueueHealthService } from '../queue/queue-health.service';
import { STEAM_SYNC_QUEUE, SteamSyncJobData } from './steam-sync.constants';

/**
 * BullMQ processor for Steam library sync jobs (ROK-417).
 * Also schedules a daily cron to sync all linked users.
 */
@Processor(STEAM_SYNC_QUEUE)
export class SteamSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SteamSyncProcessor.name);

  constructor(
    private readonly steamService: SteamService,
    private readonly steamWishlistService: SteamWishlistService,
    private readonly settingsService: SettingsService,
    @InjectQueue(STEAM_SYNC_QUEUE) private readonly syncQueue: Queue,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit() {
    this.queueHealth.register(this.syncQueue);
  }

  async process(
    job: Job<SteamSyncJobData>,
  ): Promise<{ usersProcessed: number; totalNewInterests: number }> {
    this.logger.log(`Starting Steam sync (trigger: ${job.data.trigger})`);
    await job.updateProgress(0);

    const result = await this.steamService.syncAllLinkedUsers();

    await job.updateProgress(50);
    this.logger.log(
      `Steam library sync complete: ${result.usersProcessed} users, ${result.totalNewInterests} new interests`,
    );

    const wishlistResult =
      await this.steamWishlistService.syncAllLinkedUsersWishlist();

    await job.updateProgress(100);
    this.logger.log(
      `Steam wishlist sync complete: ${wishlistResult.usersProcessed} users, ${wishlistResult.totalNewInterests} new interests`,
    );

    return result;
  }

  /**
   * Daily cron: sync all linked Steam users at 4:00 AM.
   * Only runs if Steam API key is configured.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, {
    name: 'SteamSyncProcessor_scheduledSync',
  })
  async scheduledSync() {
    const configured = await this.settingsService.isSteamConfigured();
    if (!configured) return;

    await this.syncQueue.add(
      'daily-sync',
      { trigger: 'scheduled' },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log('Daily Steam sync job enqueued');
  }
}
