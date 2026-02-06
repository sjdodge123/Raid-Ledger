import { pgTable, integer, boolean } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * User notification preferences table (ROK-197)
 * Controls which notification categories users want to receive
 */
export const userNotificationPreferences = pgTable(
  'user_notification_preferences',
  {
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .primaryKey(),
    /** Master toggle for in-app notifications */
    inAppEnabled: boolean('in_app_enabled').default(true).notNull(),
    /** Receive notifications when a roster slot becomes available */
    slotVacated: boolean('slot_vacated').default(true).notNull(),
    /** Receive event reminder notifications */
    eventReminders: boolean('event_reminders').default(true).notNull(),
    /** Receive notifications about new events */
    newEvents: boolean('new_events').default(true).notNull(),
    /** Receive notifications for subscribed games */
    subscribedGames: boolean('subscribed_games').default(true).notNull(),
  },
);

// Type inference helpers
export type UserNotificationPreferences =
  typeof userNotificationPreferences.$inferSelect;
export type NewUserNotificationPreferences =
  typeof userNotificationPreferences.$inferInsert;
