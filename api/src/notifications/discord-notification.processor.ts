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

/** Maximum length for mobile push notification content. */
const MAX_CONTENT_LENGTH = 150;

/**
 * Build a plaintext content string for Discord push notification previews (ROK-756, ROK-822).
 * Discord mobile push notifications show the message `content` field as-is,
 * without rendering Discord-specific tokens (timestamps, channel mentions, markdown).
 * By providing a clean plaintext `content`, the push notification is human-readable
 * while the rich embed still renders normally in the Discord client.
 */
export function buildPlaintextContent(title: string, message: string): string {
  const safeTitle = sanitizeValue(title);
  const safeMessage = sanitizeValue(message);
  const cleaned = stripDiscordMarkup(`${safeTitle}\n${safeMessage}`).trim();
  if (cleaned.length <= MAX_CONTENT_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_CONTENT_LENGTH - 3) + '...';
}

/** Safely convert a value to a string, guarding against null/undefined/objects. */
function sanitizeValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return '';
}

/** Strip Discord markup, markdown formatting, and collapse whitespace. */
function stripDiscordMarkup(text: string): string {
  return text
    .replace(/<t:(\d+)(?::[a-zA-Z])?>/g, (_, epoch) =>
      formatEpoch(Number(epoch)),
    )
    .replace(/<#\d+>/g, '#channel')
    .replace(/<@&\d+>/g, '@role')
    .replace(/<@!?\d+>/g, '@user')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/ {2,}/g, ' ');
}

/** Format a Unix epoch (seconds) into a short, human-readable date string. */
function formatEpoch(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}
