import { pgTable, serial, text, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  discordId: text('discord_id').unique(), // Nullable for local-only users who link Discord later
  username: text('username').notNull(),
  avatar: text('avatar'),
  customAvatarUrl: text('custom_avatar_url'),
  isAdmin: boolean('is_admin').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
