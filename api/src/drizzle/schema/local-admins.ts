import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Local admin accounts for self-hosted deployments.
 * Allows login via email/password before Discord OAuth is configured.
 */
export const localAdmins = pgTable('local_admins', {
  id: serial('id').primaryKey(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  userId: integer('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
