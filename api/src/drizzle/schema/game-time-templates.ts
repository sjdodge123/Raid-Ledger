import {
  pgTable,
  serial,
  integer,
  smallint,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Game time templates table (ROK-189)
 * Stores recurring weekly game time slots for each user.
 * Each row = one hour-slot the user is typically available to play.
 */
export const gameTimeTemplates = pgTable(
  'game_time_templates',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    dayOfWeek: smallint('day_of_week').notNull(), // 0=Mon, 6=Sun
    startHour: smallint('start_hour').notNull(), // 0-23
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    uniqueUserSlot: unique('unique_user_game_time_slot').on(
      table.userId,
      table.dayOfWeek,
      table.startHour,
    ),
    userIdIdx: index('game_time_templates_user_id_idx').on(table.userId),
  }),
);

export type GameTimeTemplate = typeof gameTimeTemplates.$inferSelect;
export type NewGameTimeTemplate = typeof gameTimeTemplates.$inferInsert;
