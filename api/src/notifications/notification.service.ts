import { eventBoundNoticeStillLive } from './notification-expiry.helpers';
import { defined } from '../common/defined.helpers';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, isNull, desc, lt, not, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { DiscordNotificationService } from './discord-notification.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import {
  resolveEventVoicePayload,
  type EventVoicePayload,
} from './notification-voice.helpers';
import {
  mapNotificationToDto,
  mapPreferencesToDto,
} from './notification-mapping.helpers';
import { createManyNotifications } from './notification-batch.helpers';
import {
  mergePreferences,
  detectDiscordEnabled,
} from './notification-prefs.helpers';
import type {
  CreateNotificationInput,
  NotificationDto,
  NotificationPreferencesDto,
  UpdatePreferencesInput,
} from './notification.types';

export type {
  ChannelPrefs,
  NotificationType,
  Channel,
  CreateNotificationInput,
  NotificationDto,
  NotificationPreferencesDto,
  UpdatePreferencesInput,
} from './notification.types';

/**
 * Service for managing user notifications (ROK-197, ROK-179).
 * Handles in-app notification CRUD and user preferences.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    @Optional()
    @Inject(DiscordNotificationService)
    private discordNotificationService: DiscordNotificationService | null,
    @Optional()
    @Inject(ChannelResolverService)
    private channelResolver: ChannelResolverService | null,
    private readonly cronJobService: CronJobService,
    @Optional()
    @Inject(SettingsService)
    private readonly settings: SettingsService | null = null,
  ) {}

  /** Create a new notification for a user, checking preferences first. */
  async create(
    input: CreateNotificationInput,
  ): Promise<NotificationDto | null> {
    const prefs = await this.getPreferences(input.userId);
    if (!this.isCategoryEnabled(input.type, prefs)) {
      this.logger.debug(
        `Skipping notification for user ${input.userId}: ${input.type} in-app disabled`,
      );
      return null;
    }

    const [row] = await this.db
      .insert(schema.notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        payload: input.payload ?? null,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    const created = defined(row, 'inserted notification');

    this.logger.log(
      `Created notification ${created.id} for user ${input.userId} (${input.type})`,
    );
    this.dispatchDiscord(input, created.id);
    return mapNotificationToDto(created);
  }

  /** Create notifications for many users in a single batch (ROK-1043). */
  createMany(inputs: CreateNotificationInput[]): Promise<NotificationDto[]> {
    return createManyNotifications(
      this.db,
      this.logger,
      this.discordNotificationService,
      inputs,
    );
  }

  /** Get unread notifications for a user. */
  async getUnread(userId: number): Promise<NotificationDto[]> {
    const rows = await this.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.readAt),
        ),
      )
      .orderBy(desc(schema.notifications.createdAt));
    return rows.map(mapNotificationToDto);
  }

  /** Get all notifications for a user (paginated). */
  async getAll(
    userId: number,
    limit = 20,
    offset = 0,
  ): Promise<NotificationDto[]> {
    const rows = await this.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map(mapNotificationToDto);
  }

  /** Get count of unread notifications for a user. */
  async getUnreadCount(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.readAt),
        ),
      );
    return Number(defined(result, 'unread count row').count);
  }

  /** Mark a single notification as read. */
  async markRead(userId: number, notificationId: string): Promise<void> {
    const [notification] = await this.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, notificationId))
      .limit(1);
    if (!notification)
      throw new NotFoundException(`Notification ${notificationId} not found`);
    if (notification.userId !== userId)
      throw new ForbiddenException('You do not own this notification');
    await this.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(eq(schema.notifications.id, notificationId));
    this.logger.log(
      `User ${userId} marked notification ${notificationId} as read`,
    );
  }

  /** Mark all notifications as read for a user. */
  async markAllRead(userId: number): Promise<void> {
    await this.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.readAt),
        ),
      );
    this.logger.log(`User ${userId} marked all notifications as read`);
  }

  /** Get notification preferences for a user, creating defaults if needed. */
  async getPreferences(userId: number): Promise<NotificationPreferencesDto> {
    const [prefs] = await this.db
      .select()
      .from(schema.userNotificationPreferences)
      .where(eq(schema.userNotificationPreferences.userId, userId))
      .limit(1);
    if (!prefs) {
      const [created] = await this.db
        .insert(schema.userNotificationPreferences)
        .values({ userId })
        .returning();
      this.logger.debug(`Created default preferences for user ${userId}`);
      return mapPreferencesToDto(
        defined(created, 'inserted notification preferences'),
      );
    }
    return mapPreferencesToDto(prefs);
  }

  /** Update notification preferences with deep merge (ROK-180 AC-1). */
  async updatePreferences(
    userId: number,
    input: UpdatePreferencesInput,
  ): Promise<NotificationPreferencesDto> {
    const current = await this.getPreferences(userId);
    const merged = mergePreferences(current.channelPrefs, input);
    const discordJustEnabled = detectDiscordEnabled(
      current.channelPrefs,
      merged,
    );

    const [updated] = await this.db
      .update(schema.userNotificationPreferences)
      .set({ channelPrefs: merged })
      .where(eq(schema.userNotificationPreferences.userId, userId))
      .returning();
    this.logger.log(`User ${userId} updated notification preferences`);

    if (discordJustEnabled && this.discordNotificationService) {
      this.discordNotificationService
        .sendWelcomeDM(userId)
        .catch((err: unknown) => {
          this.logger.warn(
            `Failed to send welcome DM: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        });
    }
    return mapPreferencesToDto(
      defined(updated, 'updated notification preferences'),
    );
  }

  @Cron('30 0 4 * * *', {
    name: 'NotificationService_cleanupExpiredNotifications',
  })
  async cleanupExpiredNotifications(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'NotificationService_cleanupExpiredNotifications',
      async () => {
        if ((await this.cleanupExpired()) === 0) return false;
      },
    );
  }

  /** ROK-507: Resolve voice channel ID for an event's game. */
  async resolveVoiceChannelId(gameId?: number | null): Promise<string | null> {
    if (!this.channelResolver) return null;
    return this.channelResolver.resolveVoiceChannelForScheduledEvent(gameId);
  }

  /**
   * The DM voice payload for an event — the event embeds' own decision: a
   * planned temporary channel (name + open time) wins, else the ROK-1389
   * voice-aware link (a text override no longer wins).
   */
  async resolveVoiceForEvent(eventId: number): Promise<EventVoicePayload> {
    if (!this.channelResolver) return {};
    const deps = {
      channelResolver: this.channelResolver,
      settings: this.settings ?? undefined,
    };
    return resolveEventVoicePayload(this.db, deps, eventId);
  }

  /** ROK-538: Look up the Discord embed URL for an event. */
  async getDiscordEmbedUrl(eventId: number): Promise<string | null> {
    const [row] = await this.db
      .select({
        guildId: schema.discordEventMessages.guildId,
        channelId: schema.discordEventMessages.channelId,
        messageId: schema.discordEventMessages.messageId,
      })
      .from(schema.discordEventMessages)
      .where(eq(schema.discordEventMessages.eventId, eventId))
      .limit(1);
    if (!row) return null;
    return `https://discord.com/channels/${row.guildId}/${row.channelId}/${row.messageId}`;
  }

  /** Delete expired notifications. */
  async cleanupExpired(): Promise<number> {
    const now = new Date();
    const result = await this.db
      .delete(schema.notifications)
      .where(
        and(
          not(isNull(schema.notifications.expiresAt)),
          lt(schema.notifications.expiresAt, now),
          not(eventBoundNoticeStillLive(now)),
        ),
      )
      .returning();
    this.logger.log(`Cleaned up ${result.length} expired notifications`);
    return result.length;
  }

  /** Check if in-app notifications are enabled for a given type. */
  private isCategoryEnabled(
    type: NotificationType,
    prefs: NotificationPreferencesDto,
  ): boolean {
    return prefs.channelPrefs[type]?.inApp ?? true;
  }

  /** Fire-and-forget Discord dispatch. */
  private dispatchDiscord(
    input: CreateNotificationInput,
    notificationId: string,
  ): void {
    if (!this.discordNotificationService || input.skipDiscord) return;
    this.discordNotificationService
      .dispatch({
        notificationId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to dispatch Discord notification: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
  }
}
