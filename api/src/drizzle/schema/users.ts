import {
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    discordId: text('discord_id').unique(), // Nullable for local-only users who link Discord later
    username: text('username').notNull(),
    displayName: varchar('display_name', { length: 30 }),
    avatar: text('avatar'),
    customAvatarUrl: text('custom_avatar_url'),
    role: text('role', { enum: ['member', 'operator', 'admin'] })
      .default('member')
      .notNull(),
    onboardingCompletedAt: timestamp('onboarding_completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'display_name_length',
      sql`${table.displayName} IS NULL OR (LENGTH(${table.displayName}) >= 2 AND LENGTH(${table.displayName}) <= 30)`,
    ),
  ],
);
