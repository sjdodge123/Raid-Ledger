import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { guilds } from './guilds';

/**
 * ROK-1830 S5 (D11-B, spec Q9): one row per user x onboarding prompt that the
 * user dismissed. Stored server-side rather than in localStorage so a
 * dismissal follows the operator between devices.
 *
 * `guild_id` is NULL for a global prompt (the Players-page "get your guild"
 * card) and set for a per-hub prompt (the editor setup checklist).
 *
 * Uniqueness needs TWO indexes because Postgres UNIQUE treats NULL as
 * never-equal: the plain one covers the scoped rows (and leads with user_id,
 * so it also indexes the users FK), the partial one covers the global rows.
 * Personal data — wiped with the user (users-delete.helpers.ts WIPE_BY_COLUMN).
 */
export const hubOnboardingDismissals = pgTable(
  'hub_onboarding_dismissals',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    guildId: integer('guild_id').references(() => guilds.id, {
      onDelete: 'cascade',
    }),
    key: varchar('key', { length: 64 }).notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('hub_onboarding_dismissals_user_guild_key_uq').on(
      t.userId,
      t.guildId,
      t.key,
    ),
    uniqueIndex('hub_onboarding_dismissals_user_key_global_uq')
      .on(t.userId, t.key)
      .where(sql`${t.guildId} is null`),
    index('hub_onboarding_dismissals_guild_id_idx').on(t.guildId),
  ],
);
