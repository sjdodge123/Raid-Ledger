import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { SettingsService } from '../settings/settings.service';
import {
  DISCORD_NOTIFICATION_QUEUE,
  RATE_LIMIT_WINDOW_MS,
  MAX_CONSECUTIVE_FAILURES,
  type DiscordNotificationJobData,
} from './discord-notification.constants';

/**
 * Service for dispatching Discord DM notifications (ROK-180).
 *
 * Responsibilities:
 * - Check eligibility (Discord linked, preferences enabled, full member)
 * - Enqueue notifications for background delivery
 * - Rate limiting per user per type
 * - Welcome DM on first Discord enable
 * - Failure tracking and auto-disable
 */
@Injectable()
export class DiscordNotificationService {
  private readonly logger = new Logger(DiscordNotificationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    @InjectQueue(DISCORD_NOTIFICATION_QUEUE) private queue: Queue,
    private readonly clientService: DiscordBotClientService,
    private readonly embedService: DiscordNotificationEmbedService,
    private readonly settingsService: SettingsService,
    @Inject(REDIS_CLIENT)
    private redis: Redis,
  ) {}

  /**
   * Attempt to send a Discord notification for a user.
   * Checks all preconditions (AC-2) and enqueues if eligible.
   *
   * @returns true if enqueued, false if skipped
   */
  async dispatch(input: {
    notificationId: string;
    userId: number;
    type: NotificationType;
    title: string;
    message: string;
    payload?: Record<string, unknown>;
  }): Promise<boolean> {
    // (a) Check user has Discord linked
    const [user] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);

    if (!user?.discordId) {
      this.logger.debug(
        `User ${input.userId}: no Discord linked, skipping Discord notification`,
      );
      return false;
    }

    // (d) Full RL members have an entry in the users table with a discordId.
    // Anonymous participants from Quick Sign Up (ROK-137) don't have user table entries.

    // (b) Check user has Discord channel enabled in preferences
    const [prefs] = await this.db
      .select()
      .from(schema.userNotificationPreferences)
      .where(eq(schema.userNotificationPreferences.userId, input.userId))
      .limit(1);

    if (prefs) {
      const channelPrefs = prefs.channelPrefs as Record<
        string,
        Record<string, boolean>
      >;
      // (c) Check notification type is enabled for Discord
      const typePrefs = channelPrefs[input.type];
      if (typePrefs && typePrefs.discord === false) {
        this.logger.debug(
          `User ${input.userId}: Discord disabled for ${input.type}, skipping`,
        );
        return false;
      }
    }

    // Check bot is connected
    if (!this.clientService.isConnected()) {
      this.logger.debug('Discord bot not connected, skipping notification');
      return false;
    }

    // Rate limiting (AC-5): check if we already sent this type recently
    // ROK-489: include reminderWindow in key so each window gets its own rate limit slot
    const subType = (input.payload?.reminderWindow as string | undefined) ?? '';
    const rateLimitKey = `discord-notif:rate:${input.userId}:${input.type}${subType ? `:${subType}` : ''}`;
    const recentCount = await this.redis.get(rateLimitKey);

    if (recentCount && parseInt(recentCount, 10) > 0) {
      this.logger.debug(
        `User ${input.userId}: rate limited for ${input.type}, skipping Discord DM`,
      );
      return false;
    }

    // Set rate limit key
    await this.redis.set(rateLimitKey, '1', 'PX', RATE_LIMIT_WINDOW_MS);

    // Enqueue for background delivery
    await this.queue.add(
      'send-dm',
      {
        notificationId: input.notificationId,
        userId: input.userId,
        discordId: user.discordId,
        type: input.type,
        title: input.title,
        message: input.message,
        payload: input.payload,
      } satisfies DiscordNotificationJobData,
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(
      `Enqueued Discord notification for user ${input.userId} (${input.type})`,
    );
    return true;
  }

  /**
   * Send a welcome DM when a user enables Discord notifications for the first time (AC-1).
   */
  async sendWelcomeDM(userId: number): Promise<void> {
    const [user] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user?.discordId) return;

    if (!this.clientService.isConnected()) {
      this.logger.debug('Bot not connected, skipping welcome DM');
      return;
    }

    // Check if we already sent a welcome DM (tracked in Redis)
    const welcomeKey = `discord-notif:welcome:${userId}`;
    const alreadySent = await this.redis.get(welcomeKey);
    if (alreadySent) return;

    try {
      const branding = await this.settingsService.getBranding();
      const { embed, row } = await this.embedService.buildWelcomeEmbed(
        branding.communityName ?? 'Raid Ledger',
        branding.communityAccentColor,
      );

      await this.clientService.sendEmbedDM(user.discordId, embed, row);

      // Mark as sent (no expiry — one-time event)
      await this.redis.set(welcomeKey, '1');

      this.logger.log(`Sent welcome DM to user ${userId}`);
    } catch (error) {
      this.logger.warn(
        `Failed to send welcome DM to user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Record a delivery failure and potentially auto-disable Discord (AC-6).
   */
  async recordFailure(userId: number): Promise<void> {
    const failureKey = `discord-notif:failures:${userId}`;

    const count = await this.redis.incr(failureKey);
    // Set TTL on first failure only (fixed 24-hour window, not rolling).
    // Counter resets after 24h regardless of subsequent failures within that window.
    if (count === 1) {
      await this.redis.expire(failureKey, 86400);
    }

    if (count >= MAX_CONSECUTIVE_FAILURES) {
      this.logger.warn(
        `User ${userId}: ${count} consecutive Discord failures, auto-disabling`,
      );
      await this.autoDisableDiscord(userId);
      await this.redis.del(failureKey);
    }
  }

  /**
   * Reset failure count on successful delivery.
   */
  async resetFailures(userId: number): Promise<void> {
    await this.redis.del(`discord-notif:failures:${userId}`);
  }

  /**
   * Auto-disable Discord notifications for a user and send in-app notification (AC-6).
   */
  private async autoDisableDiscord(userId: number): Promise<void> {
    // Disable Discord for all notification types
    const [prefs] = await this.db
      .select()
      .from(schema.userNotificationPreferences)
      .where(eq(schema.userNotificationPreferences.userId, userId))
      .limit(1);

    if (prefs) {
      const currentPrefs = prefs.channelPrefs;
      const updatedPrefs = { ...currentPrefs };
      for (const type of Object.keys(updatedPrefs) as NotificationType[]) {
        if (updatedPrefs[type]) {
          updatedPrefs[type] = { ...updatedPrefs[type], discord: false };
        }
      }

      await this.db
        .update(schema.userNotificationPreferences)
        .set({ channelPrefs: updatedPrefs })
        .where(eq(schema.userNotificationPreferences.userId, userId));
    }

    // Create in-app notification about the issue
    const { title, message } =
      this.embedService.buildUnreachableNotificationMessage();

    await this.db.insert(schema.notifications).values({
      userId,
      type: 'system',
      title,
      message,
    });

    this.logger.log(`Auto-disabled Discord notifications for user ${userId}`);
  }
}
