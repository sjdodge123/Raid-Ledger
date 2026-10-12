import {
  pgTable,
  integer,
  date,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * ROK-1593 (epic ROK-669): dates a user told us to ignore when deriving
 * calendar away days ("Ignore" on a synced absence). Personal — wiped with the
 * user (users-delete.helpers.ts WIPE_BY_COLUMN). The PK leads with user_id,
 * which also backs the users FK.
 */
export const calendarIgnoredDays = pgTable(
  'calendar_ignored_days',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);
