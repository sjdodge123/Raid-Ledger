import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';

/**
 * ROK-1893 P1 (M4, spec §8d): a one-per-(hub, user) prompt raised by
 * auto-membership when a user signs up for / votes on something of the hub.
 * `suggest` asks them "Join <hub>?" (Join / Not now); `auto-joined` is the
 * one-time "You joined <hub>" notice after an `auto` join. There is no leader
 * queue. The (guild, user) unique makes a dismissal stick — a later signup
 * never re-prompts. Personal UI state — wiped with the user
 * (users-delete.helpers.ts WIPE_BY_COLUMN).
 */
export const hubJoinPrompts = pgTable(
  'hub_join_prompts',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    kind: varchar('kind', {
      length: 12,
      enum: ['suggest', 'auto-joined'],
    }).notNull(),
    /** What triggered it: an event signup or a poll vote. */
    source: varchar('source', {
      length: 8,
      enum: ['signup', 'vote'],
    }).notNull(),
    /** The event / poll id behind `source` (not an FK; may outlive it). */
    sourceRef: integer('source_ref'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'hub_join_prompts_kind_check',
      sql`${table.kind} IN ('suggest', 'auto-joined')`,
    ),
    check(
      'hub_join_prompts_source_check',
      sql`${table.source} IN ('signup', 'vote')`,
    ),
    // guild_id leads the unique, which backs the guilds FK (ROK-1157).
    uniqueIndex('idx_hub_join_prompts_guild_user').on(
      table.guildId,
      table.userId,
    ),
    index('idx_hub_join_prompts_user_id').on(table.userId),
  ],
);

export type HubJoinPromptInsert = typeof hubJoinPrompts.$inferInsert;
export type HubJoinPromptSelect = typeof hubJoinPrompts.$inferSelect;
