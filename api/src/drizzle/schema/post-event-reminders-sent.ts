import {
  pgTable,
  serial,
  uuid,
  integer,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { pugSlots } from './pug-slots';
import { events } from './events';

/**
 * Tracks which post-event onboarding reminders have been sent to PUGs (ROK-403).
 * Prevents duplicate sends via unique constraint on (event_id, pug_slot_id).
 */
export const postEventRemindersSent = pgTable(
  'post_event_reminders_sent',
  {
    id: serial('id').primaryKey(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    pugSlotId: uuid('pug_slot_id')
      .references(() => pugSlots.id, { onDelete: 'cascade' })
      .notNull(),
    sentAt: timestamp('sent_at').defaultNow().notNull(),
  },
  (table) => [
    unique('unique_post_event_pug_reminder').on(table.eventId, table.pugSlotId),
  ],
);

export type PostEventReminderSent = typeof postEventRemindersSent.$inferSelect;
export type NewPostEventReminderSent =
  typeof postEventRemindersSent.$inferInsert;
