import { pgTable, text, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => [
    // Performance index for cleanup queries
    index('idx_sessions_expires_at').on(table.expiresAt),
  ],
);
