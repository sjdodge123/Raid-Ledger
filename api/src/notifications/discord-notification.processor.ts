import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
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

/**
 * Bull queue processor for Discord DM delivery (ROK-180 AC-5).
 * Processes jobs from the discord-notification queue.
 * Retries up to 3 times with exponential backoff.
 */
@Processor(DISCORD_NOTIFICATION_QUEUE)
export class DiscordNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscordNotificationProcessor.name);

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly embedService: DiscordNotificationEmbedService,
    private readonly discordNotificationService: DiscordNotificationService,
    private readonly settingsService: SettingsService,
  ) {
    super();
  }

  async process(job: Job<DiscordNotificationJobData>): Promise<void> {
    const { notificationId, userId, discordId, type, title, message, payload } =
      job.data;
    const start = isPerfEnabled() ? performance.now() : 0;

    this.logger.debug(
      `Processing Discord notification job ${job.id} for user ${userId} (${type})`,
    );

    if (!this.clientService.isConnected()) {
      this.logger.warn('Discord bot not connected, failing job for retry');
      throw new Error('Discord bot not connected');
    }

    try {
      const branding = await this.settingsService.getBranding();
      const communityName = branding.communityName ?? 'Raid Ledger';

      const { embed, row, rows } =
        await this.embedService.buildNotificationEmbed(
          {
            notificationId,
            type: type as NotificationType,
            title,
            message,
            payload: payload,
          },
          communityName,
        );

      await this.clientService.sendEmbedDM(discordId, embed, row, rows);

      // Reset failure count on success
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
      this.logger.warn(
        `Failed to send Discord DM to user ${userId} (attempt ${job.attemptsMade + 1}): ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      // Record failure on final attempt
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 3)) {
        await this.discordNotificationService.recordFailure(userId);
      }

      throw error;
    }
  }
}
