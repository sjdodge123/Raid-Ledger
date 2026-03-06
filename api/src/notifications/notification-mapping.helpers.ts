/**
 * Notification mapping helpers.
 * Extracted from notification.service.ts for file size compliance (ROK-711).
 */
import {
  DEFAULT_CHANNEL_PREFS,
  type ChannelPrefs,
} from '../drizzle/schema/notification-preferences';
import * as schema from '../drizzle/schema';
import type {
  Channel,
  NotificationDto,
  NotificationPreferencesDto,
} from './notification.types';

/** Map a notifications DB row to a DTO. */
export function mapNotificationToDto(
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

/** Map preferences row to DTO, merging stored JSONB with defaults to handle new types. */
export function mapPreferencesToDto(
  row: typeof schema.userNotificationPreferences.$inferSelect,
): NotificationPreferencesDto {
  const stored = (row.channelPrefs ?? {}) as Partial<ChannelPrefs>;
  const merged: ChannelPrefs = { ...DEFAULT_CHANNEL_PREFS };
  for (const [type, channels] of Object.entries(stored)) {
    const notifType = type as keyof ChannelPrefs;
    if (merged[notifType] && channels) {
      merged[notifType] = {
        ...merged[notifType],
        ...(channels as Record<Channel, boolean>),
      };
    }
  }
  return { userId: row.userId, channelPrefs: merged };
}
