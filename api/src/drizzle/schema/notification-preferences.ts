import { pgTable, integer, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * All supported notification types.
 */
export const NOTIFICATION_TYPES = [
  'slot_vacated',
  'event_reminder',
  'new_event',
  'subscribed_game',
  'achievement_unlocked',
  'level_up',
  'missed_event_nudge',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Delivery channels for notifications.
 */
export const CHANNELS = ['inApp', 'push', 'discord'] as const;
export type Channel = (typeof CHANNELS)[number];

export type ChannelPrefs = Record<NotificationType, Record<Channel, boolean>>;

/**
 * Default channel preferences matrix.
 * Existing types: all channels on.
 * Future/new types (achievement, level-up, nudge): in-app only.
 */
export const DEFAULT_CHANNEL_PREFS: ChannelPrefs = {
  slot_vacated: { inApp: true, push: true, discord: true },
  event_reminder: { inApp: true, push: true, discord: true },
  new_event: { inApp: true, push: true, discord: true },
  subscribed_game: { inApp: true, push: true, discord: true },
  achievement_unlocked: { inApp: true, push: false, discord: false },
  level_up: { inApp: true, push: false, discord: false },
  missed_event_nudge: { inApp: true, push: false, discord: false },
};

/**
 * User notification preferences table (ROK-197, ROK-179)
 * Stores per-type-per-channel preference matrix as JSONB.
 */
export const userNotificationPreferences = pgTable(
  'user_notification_preferences',
  {
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .primaryKey(),
    channelPrefs: jsonb('channel_prefs')
      .$type<ChannelPrefs>()
      .default(DEFAULT_CHANNEL_PREFS)
      .notNull(),
  },
);

// Type inference helpers
export type UserNotificationPreferences =
  typeof userNotificationPreferences.$inferSelect;
export type NewUserNotificationPreferences =
  typeof userNotificationPreferences.$inferInsert;
