import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { events } from './events';
import { users } from './users';

/**
 * Tracks which event reminders have been sent to prevent duplicates (ROK-185).
 * Uses a unique constraint on (event_id, user_id, reminder_type) + ON CONFLICT DO NOTHING
 * for atomic idempotent inserts.
 */
export const eventRemindersSent = pgTable(
  'event_reminders_sent',
  {
    id: serial('id').primaryKey(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    reminderType: varchar('reminder_type', { length: 30 }).notNull(),
    sentAt: timestamp('sent_at').defaultNow().notNull(),
  },
  (table) => [
    unique('unique_event_user_reminder').on(
      table.eventId,
      table.userId,
      table.reminderType,
    ),
  ],
);

export type EventReminderSent = typeof eventRemindersSent.$inferSelect;
export type NewEventReminderSent = typeof eventRemindersSent.$inferInsert;
