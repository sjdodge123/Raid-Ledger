import { Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
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

type ErrorClass = 'permanent-deactivate' | 'permanent-prefs-only' | 'transient';

/**
 * Classify a DM-send error to decide the catch branch (ROK-1260, ROK-1354).
 * - 50278 ("no mutual guilds") → user left guild → permanent-deactivate
 * - 50007 ("Cannot send messages to this user") → DMs blocked but user
 *   still in guild → permanent-prefs-only (existing 3-strike disable)
 * - 10013 ("Unknown User") → account deleted (throws at client.users.fetch
 *   before send) → account is gone → permanent-deactivate (like 50278)
 * - everything else → transient (existing rethrow path)
 *
 * ROK-1354 gotcha: discord.js v14's `DiscordAPIError` (`@discordjs/rest`) has
 * a `name` GETTER returning `DiscordAPIError[<code>]` (e.g.
 * `DiscordAPIError[50278]`) — it NEVER yields the bare string `DiscordAPIError`
 * in production. ROK-1260 compared `name !== 'DiscordAPIError'`, so every real
 * prod error fell through to `transient` and escaped to Sentry. We match on
 * `name.startsWith('DiscordAPIError')` (still matches the bare name a wrapped
 * or simulated re-throw might produce) gated by the numeric `code` — the codes
 * are the stable contract, the name prefix disambiguates unrelated libs that
 * happen to reuse `.code`.
 */
function classifyDiscordError(error: unknown): ErrorClass {
  if (!error || typeof error !== 'object') return 'transient';
  const err = error as { code?: unknown; name?: unknown; message?: unknown };
  if (typeof err.name !== 'string' || !err.name.startsWith('DiscordAPIError'))
    return 'transient';
  if (err.code === 50278 || err.code === 10013) return 'permanent-deactivate';
  if (err.code === 50007) return 'permanent-prefs-only';
  return 'transient';
}

/**
 * DEMO_MODE-only test hook (ROK-1260, ROK-1354): when a job carries
 * `__simulateError` and DEMO_MODE is on, throw a synthetic `DiscordAPIError`
 * so the smoke test can deterministically exercise the classifier branches
 * without a real ex-guild / deleted Discord user. No-op in production.
 *
 * ROK-1354: emits the PRODUCTION name shape `DiscordAPIError[<code>]` (the
 * discord.js v14 getter shape) so the simulation exercises the same code path
 * a real error hits — ROK-1260 set the bare name and so masked the very bug it
 * was meant to cover.
 */
function maybeThrowSimulatedError(data: DiscordNotificationJobData): void {
  if (process.env.DEMO_MODE !== 'true') return;
  if (!data.__simulateError) return;
  const messages: Record<number, string> = {
    50278: 'Cannot send messages to this user due to having no mutual guilds',
    50007: 'Cannot send messages to this user',
    10013: 'Unknown User',
  };
  const code = data.__simulateError;
  const err = new Error(messages[code] ?? 'Simulated error');
  err.name = `DiscordAPIError[${code}]`;
  (err as Error & { code: number }).code = code;
  throw err;
}

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
    if (await this.discordNotificationService.isUserDeactivated(userId)) {
      this.logger.debug(
        `ROK-1260: skipping queued job ${job.id} — user ${userId} is deactivated`,
      );
      return;
    }
    if (!this.clientService.isConnected()) {
      this.logger.warn('Discord bot not connected, failing job for retry');
      throw new Error('Discord bot not connected');
    }
    Sentry.setUser({ id: userId.toString(), username: discordId });
    try {
      maybeThrowSimulatedError(job.data);
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
      const kind = classifyDiscordError(error);
      if (kind === 'permanent-deactivate') {
        this.logger.warn(
          `ROK-1260/ROK-1354: 50278/10013 for user ${userId} — deactivating, swallowing error`,
        );
        await this.discordNotificationService.deactivateUser(userId);
        return;
      }
      if (kind === 'permanent-prefs-only') {
        this.logger.warn(
          `ROK-1260: 50007 for user ${userId} — recording failure, swallowing error`,
        );
        await this.discordNotificationService
          .recordFailure(userId)
          .catch(() => {});
        return;
      }
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
    const content = buildPlaintextContent(
      data.title,
      data.message,
      await this.resolveTimeZoneForContent(data),
    );
    await this.clientService.sendEmbedDM(discordId, embed, row, rows, content);
  }

  /**
   * Resolve the recipient timezone for plaintext rendering (ROK-1403) — only
   * when the content actually carries `<t:>` markup, so markup-free DMs skip
   * the extra lookup. Returns undefined → `buildPlaintextContent` renders in
   * the server TZ (irrelevant when there are no timestamps to render).
   */
  private async resolveTimeZoneForContent(
    data: DiscordNotificationJobData,
  ): Promise<string | undefined> {
    if (!/<t:\d+/.test(`${data.title}\n${data.message}`)) return undefined;
    return this.discordNotificationService.resolveRecipientTimezone(
      data.userId,
    );
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
