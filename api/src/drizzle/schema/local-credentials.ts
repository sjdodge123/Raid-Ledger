import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Local credentials for self-hosted deployments.
 * Stores email/password for local auth (admin bootstrap, etc.).
 * Discord OAuth users do not use this table.
 */
export const localCredentials = pgTable('local_credentials', {
  id: serial('id').primaryKey(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  userId: integer('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
