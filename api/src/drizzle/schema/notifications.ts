import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Notifications table (ROK-197)
 * Stores in-app notifications for users
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Notification type for categorization and filtering */
    type: text('type', {
      enum: [
        'slot_vacated',
        'event_reminder',
        'new_event',
        'subscribed_game',
        'achievement_unlocked',
        'level_up',
        'missed_event_nudge',
        'event_rescheduled',
        'bench_promoted',
      ],
    }).notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    /** Additional data (event_id, link, etc.) */
    payload: jsonb('payload'),
    /** Timestamp when notification was read (null = unread) */
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** Notifications expire after a certain period */
    expiresAt: timestamp('expires_at'),
  },
  (table) => ({
    // Composite index for efficient unread queries (userId + readAt IS NULL)
    userUnreadIdx: index('notifications_user_unread_idx').on(
      table.userId,
      table.readAt,
    ),
  }),
);

// Type inference helpers
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
