import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const eventTemplates = pgTable('event_templates', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  name: text('name').notNull(),
  /** Stores template config: title, description, gameId, durationMinutes, slotConfig, maxAttendees, autoUnbench, recurrence */
  config: jsonb('config').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
