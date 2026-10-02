/**
 * Notification mapping helpers.
 * Extracted from notification.service.ts for file size compliance (ROK-711).
 */
import {
  DEFAULT_CHANNEL_PREFS,
  NOTIFICATION_TYPES,
  type ChannelPrefs,
  type NotificationType,
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

/**
 * Resolve a stored `channel_prefs` JSONB over `DEFAULT_CHANNEL_PREFS` (TDB:899).
 * A type missing from an older row — or a user with no row (`null`/`undefined`)
 * — resolves to its default. EVERY preference reader (in-app, single DM, batch
 * DM, LFG invite) goes through this so the send paths and the settings UI agree.
 */
export function resolveChannelPrefs(stored: unknown): ChannelPrefs {
  const merged: ChannelPrefs = { ...DEFAULT_CHANNEL_PREFS };
  const entries = Object.entries((stored ?? {}) as Partial<ChannelPrefs>);
  for (const [type, channels] of entries) {
    const notifType = type as keyof ChannelPrefs;
    if (merged[notifType] && channels) {
      merged[notifType] = {
        ...merged[notifType],
        ...(channels as Record<Channel, boolean>),
      };
    }
  }
  return merged;
}

/**
 * The resolved matrix with Discord OFF for EVERY notification type, keeping
 * the stored inApp/push values (TDB:1956). Starts from the resolved matrix, not
 * the stored keys: a type missing from the row resolves to its default
 * (Discord on) on every send path, so flipping only stored keys kept DMing.
 */
export function buildDiscordDisabledPrefs(stored: unknown): ChannelPrefs {
  const resolved = resolveChannelPrefs(stored);
  const disabled = {} as ChannelPrefs;
  for (const type of NOTIFICATION_TYPES) {
    disabled[type] = { ...resolved[type], discord: false };
  }
  return disabled;
}

/** Types whose resolved Discord channel is OFF for a stored prefs value. */
export function discordDisabledTypes(stored: unknown): Set<NotificationType> {
  const resolved = resolveChannelPrefs(stored);
  const types = Object.keys(resolved) as NotificationType[];
  return new Set(types.filter((type) => resolved[type].discord === false));
}

/** Map preferences row to DTO, merging stored JSONB with defaults to handle new types. */
export function mapPreferencesToDto(
  row: typeof schema.userNotificationPreferences.$inferSelect,
): NotificationPreferencesDto {
  return {
    userId: row.userId,
    channelPrefs: resolveChannelPrefs(row.channelPrefs),
  };
}
