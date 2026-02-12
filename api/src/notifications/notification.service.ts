import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, isNull, desc, lt, not } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  DEFAULT_CHANNEL_PREFS,
  type ChannelPrefs,
  type NotificationType,
} from '../drizzle/schema/notification-preferences';

export type { ChannelPrefs, NotificationType };
export type Channel = 'inApp' | 'push' | 'discord';

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, any>;
  expiresAt?: Date;
}

export interface NotificationDto {
  id: string;
  userId: number;
  type: string;
  title: string;
  message: string;
  payload?: Record<string, any>;
  readAt?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface NotificationPreferencesDto {
  userId: number;
  channelPrefs: ChannelPrefs;
}

export interface UpdatePreferencesInput {
  channelPrefs: Partial<
    Record<NotificationType, Partial<Record<Channel, boolean>>>
  >;
}

/**
 * Service for managing user notifications (ROK-197, ROK-179).
 * Handles in-app notification CRUD and user preferences.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Create a new notification for a user.
   * Checks user preferences before creating.
   * @param input - Notification data
   * @returns Created notification or null if user has disabled this category
   */
  async create(
    input: CreateNotificationInput,
  ): Promise<NotificationDto | null> {
    // Check user preferences
    const prefs = await this.getPreferences(input.userId);

    // Check in-app channel preference for this type
    if (!this.isCategoryEnabled(input.type, prefs)) {
      this.logger.debug(
        `Skipping notification for user ${input.userId}: ${input.type} in-app disabled`,
      );
      return null;
    }

    const [created] = await this.db
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

    this.logger.log(
      `Created notification ${created.id} for user ${input.userId} (${input.type})`,
    );

    return this.mapToDto(created);
  }

  /**
   * Get unread notifications for a user.
   * @param userId - User ID
   * @returns List of unread notifications
   */
  async getUnread(userId: number): Promise<NotificationDto[]> {
    const notifications = await this.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          isNull(schema.notifications.readAt),
        ),
      )
      .orderBy(desc(schema.notifications.createdAt));

    return notifications.map((row) => this.mapToDto(row));
  }

  /**
   * Get all notifications for a user (paginated).
   * @param userId - User ID
   * @param limit - Max number of notifications to return
   * @param offset - Offset for pagination
   * @returns List of notifications
   */
  async getAll(
    userId: number,
    limit = 20,
    offset = 0,
  ): Promise<NotificationDto[]> {
    const notifications = await this.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit)
      .offset(offset);

    return notifications.map((n) => this.mapToDto(n));
  }

  /**
   * Get count of unread notifications for a user.
   * @param userId - User ID
   * @returns Unread count
   */
  async getUnreadCount(userId: number): Promise<number> {
    const unread = await this.getUnread(userId);
    return unread.length;
  }

  /**
   * Mark a single notification as read.
   * @param userId - User ID (for ownership check)
   * @param notificationId - Notification ID
   * @throws NotFoundException if notification not found
   * @throws ForbiddenException if not owned by user
   */
  async markRead(userId: number, notificationId: string): Promise<void> {
    const [notification] = await this.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, notificationId))
      .limit(1);

    if (!notification) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('You do not own this notification');
    }

    await this.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(eq(schema.notifications.id, notificationId));

    this.logger.log(
      `User ${userId} marked notification ${notificationId} as read`,
    );
  }

  /**
   * Mark all notifications as read for a user.
   * @param userId - User ID
   */
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

  /**
   * Get notification preferences for a user.
   * Creates default preferences if they don't exist.
   * Merges with defaults to handle new types added after user's prefs were created.
   * @param userId - User ID
   * @returns User preferences
   */
  async getPreferences(userId: number): Promise<NotificationPreferencesDto> {
    const [prefs] = await this.db
      .select()
      .from(schema.userNotificationPreferences)
      .where(eq(schema.userNotificationPreferences.userId, userId))
      .limit(1);

    if (!prefs) {
      // Create default preferences
      const [created] = await this.db
        .insert(schema.userNotificationPreferences)
        .values({ userId })
        .returning();

      this.logger.debug(`Created default preferences for user ${userId}`);
      return this.mapPreferencesToDto(created);
    }

    return this.mapPreferencesToDto(prefs);
  }

  /**
   * Update notification preferences for a user.
   * Deep-merges incoming partial with stored JSONB.
   * @param userId - User ID
   * @param input - Preference updates (partial channelPrefs)
   * @returns Updated preferences
   */
  async updatePreferences(
    userId: number,
    input: UpdatePreferencesInput,
  ): Promise<NotificationPreferencesDto> {
    // Ensure preferences exist and get current state
    const current = await this.getPreferences(userId);

    // Deep-merge: only overwrite keys provided
    const merged: ChannelPrefs = { ...current.channelPrefs };
    for (const [type, channels] of Object.entries(input.channelPrefs)) {
      const notifType = type as NotificationType;
      if (merged[notifType] && channels) {
        merged[notifType] = { ...merged[notifType], ...channels };
      }
    }

    const [updated] = await this.db
      .update(schema.userNotificationPreferences)
      .set({ channelPrefs: merged })
      .where(eq(schema.userNotificationPreferences.userId, userId))
      .returning();

    this.logger.log(`User ${userId} updated notification preferences`);
    return this.mapPreferencesToDto(updated);
  }

  /**
   * Delete expired notifications (for cleanup jobs).
   * Should be called periodically by a cron job.
   * @returns Number of deleted notifications
   */
  async cleanupExpired(): Promise<number> {
    const now = new Date();
    const result = await this.db
      .delete(schema.notifications)
      .where(
        and(
          not(isNull(schema.notifications.expiresAt)),
          lt(schema.notifications.expiresAt, now),
        ),
      )
      .returning();

    this.logger.log(`Cleaned up ${result.length} expired notifications`);
    return result.length;
  }

  /**
   * Check if in-app notifications are enabled for a given type.
   */
  private isCategoryEnabled(
    type: NotificationType,
    prefs: NotificationPreferencesDto,
  ): boolean {
    return prefs.channelPrefs[type]?.inApp ?? true;
  }

  /**
   * Map database row to DTO.
   */
  private mapToDto(
    row: typeof schema.notifications.$inferSelect,
  ): NotificationDto {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type,
      title: row.title,
      message: row.message,
      payload: row.payload as Record<string, any> | undefined,
      readAt: row.readAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
    };
  }

  /**
   * Map preferences row to DTO.
   * Merges stored JSONB with defaults to handle new types.
   */
  private mapPreferencesToDto(
    row: typeof schema.userNotificationPreferences.$inferSelect,
  ): NotificationPreferencesDto {
    const stored = (row.channelPrefs ?? {}) as Partial<ChannelPrefs>;
    // Merge defaults with stored: defaults fill in any missing types
    const merged: ChannelPrefs = { ...DEFAULT_CHANNEL_PREFS };
    for (const [type, channels] of Object.entries(stored)) {
      const notifType = type as NotificationType;
      if (merged[notifType] && channels) {
        merged[notifType] = {
          ...merged[notifType],
          ...(channels as Record<Channel, boolean>),
        };
      }
    }

    return {
      userId: row.userId,
      channelPrefs: merged,
    };
  }
}
