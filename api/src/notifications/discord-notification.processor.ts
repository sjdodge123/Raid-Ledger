import { Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QueueHealthService } from '../queue/queue-health.service';
import { isPerfEnabled, perfLog } from '../common/perf-logger';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { DiscordNotificationService } from './discord-notification.service';
import { SettingsService } from '../settings/settings.service';
import {
  DISCORD_NOTIFICATION_QUEUE,
  type DiscordNotificationJobData,
} from './discord-notification.constants';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { buildPlaintextContent } from './format-helpers';

/**
 * Bull queue processor for Discord DM delivery (ROK-180 AC-5).
 * Processes jobs from the discord-notification queue.
 * Retries up to 3 times with exponential backoff.
 */
@Processor(DISCORD_NOTIFICATION_QUEUE)
export class DiscordNotificationProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(DiscordNotificationProcessor.name);

  constructor(
    @InjectQueue(DISCORD_NOTIFICATION_QUEUE)
    private readonly queue: Queue,
    private readonly clientService: DiscordBotClientService,
    private readonly embedService: DiscordNotificationEmbedService,
    private readonly discordNotificationService: DiscordNotificationService,
    private readonly settingsService: SettingsService,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit() {
    this.queueHealth.register(this.queue);
  }

  async process(job: Job<DiscordNotificationJobData>): Promise<void> {
    const { userId, discordId, type } = job.data;
    const start = isPerfEnabled() ? performance.now() : 0;
    this.logger.debug(
      `Processing Discord notification job ${job.id} for user ${userId} (${type})`,
    );
    if (!this.clientService.isConnected()) {
      this.logger.warn('Discord bot not connected, failing job for retry');
      throw new Error('Discord bot not connected');
    }
    try {
      await this.buildAndSendDM(job.data, discordId);
      await this.discordNotificationService.resetFailures(userId);
      this.logger.log(
        `Sent Discord DM to user ${userId} (${type}, job ${job.id})`,
      );
      if (start)
        perfLog('QUEUE', 'discord-notification', performance.now() - start, {
          type,
          userId,
        });
    } catch (error) {
      this.handleProcessError(job, userId, error);
      throw error;
    }
  }

  /** Build the embed and send the DM. */
  private async buildAndSendDM(
    data: DiscordNotificationJobData,
    discordId: string,
  ): Promise<void> {
    const branding = await this.settingsService.getBranding();
    const communityName = branding.communityName ?? 'Raid Ledger';
    const { embed, row, rows } = await this.embedService.buildNotificationEmbed(
      {
        notificationId: data.notificationId,
        type: data.type as NotificationType,
        title: data.title,
        message: data.message,
        payload: data.payload,
      },
      communityName,
    );
    const content = buildPlaintextContent(data.title, data.message);
    await this.clientService.sendEmbedDM(discordId, embed, row, rows, content);
  }

  /** Log and track failures on final attempt. */
  private handleProcessError(
    job: Job<DiscordNotificationJobData>,
    userId: number,
    error: unknown,
  ): void {
    this.logger.warn(
      `Failed to send Discord DM to user ${userId} (attempt ${job.attemptsMade + 1}): ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 3)) {
      this.discordNotificationService.recordFailure(userId).catch(() => {});
    }
  }
}
