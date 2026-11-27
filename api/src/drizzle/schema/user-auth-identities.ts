import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/**
 * ROK-2371: external sign-in identities (Google today). One row per
 * (provider, subject); Discord stays in `users.discord_id`.
 *
 * `subject` is the provider's stable id (Google `sub`) — the ONLY lookup key.
 * `email` is display-only and never matched against anything (ruling 1: no
 * auto-link by email).
 */
export const userAuthIdentities = pgTable(
  'user_auth_identities',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 16 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    email: varchar('email', { length: 320 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    // One Google account → one RL user, globally.
    uniqueIndex('user_auth_identities_provider_subject_uq').on(
      t.provider,
      t.subject,
    ),
    // Leads with user_id → also backs the users FK (fk-index-coverage.spec.ts).
    uniqueIndex('user_auth_identities_user_id_provider_uq').on(
      t.userId,
      t.provider,
    ),
    check(
      'user_auth_identities_provider_chk',
      sql`${t.provider} IN ('google')`,
    ),
  ],
);
