import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  uuid,
  varchar,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { characters } from './characters';

/**
 * Series memberships (ROK-1728): a user joined every future night of a
 * recurring series (`events.recurrence_group_id`) in one click.
 *
 * - `status`: 'active' | 'left' (user left) | 'ended' (system ended it)
 * - `ended_reason`: 'user_left' | 'deactivated' | 'series_cancelled' | 'series_deleted'
 *
 * `recurrence_group_id` has no FK (precedent: `channel_bindings`). At most one
 * ACTIVE membership per (group, user); left/ended rows are history.
 * Per-night signups point back via `event_signups.series_signup_id`.
 */
export const seriesSignups = pgTable(
  'series_signups',
  {
    id: serial('id').primaryKey(),
    recurrenceGroupId: uuid('recurrence_group_id').notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    characterId: uuid('character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    preferredRoles: text('preferred_roles').array(),
    status: varchar('status', { length: 20 }).default('active').notNull(),
    endedReason: varchar('ended_reason', { length: 30 }),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
  },
  (table) => [
    uniqueIndex('uq_series_signups_active')
      .on(table.recurrenceGroupId, table.userId)
      .where(sql`${table.status} = 'active'`),
    index('idx_series_signups_group').on(table.recurrenceGroupId),
    index('idx_series_signups_user').on(table.userId),
    // FK backing index (fk-index-coverage.spec.ts)
    index('idx_series_signups_character_id').on(table.characterId),
  ],
);
