import {
  pgTable,
  serial,
  integer,
  smallint,
  varchar,
  date,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Per-hour date-specific overrides that take precedence over the recurring template.
 * E.g., "I'm NOT available next Monday 8pm" without changing the recurring Monday template.
 */
export const gameTimeOverrides = pgTable(
  'game_time_overrides',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    date: date('date').notNull(),
    hour: smallint('hour').notNull(),
    status: varchar('status', { length: 20 }).notNull(), // 'available' or 'blocked'
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    uniqueUserDateHour: unique('unique_user_override_date_hour').on(
      table.userId,
      table.date,
      table.hour,
    ),
    userIdIdx: index('game_time_overrides_user_id_idx').on(table.userId),
  }),
);

export type GameTimeOverride = typeof gameTimeOverrides.$inferSelect;
export type NewGameTimeOverride = typeof gameTimeOverrides.$inferInsert;

/**
 * Date-range absences for multi-week unavailability (travel, vacation, etc.).
 * All hours within the range are blocked regardless of template or overrides.
 */
export const gameTimeAbsences = pgTable(
  'game_time_absences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    reason: varchar('reason', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('game_time_absences_user_id_idx').on(table.userId),
  }),
);

export type GameTimeAbsence = typeof gameTimeAbsences.$inferSelect;
export type NewGameTimeAbsence = typeof gameTimeAbsences.$inferInsert;
