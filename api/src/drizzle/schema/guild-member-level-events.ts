import {
  pgTable,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { guilds } from './guilds';
import { guildMembers } from './guild-members';

/**
 * ROK-1919: a guild member's level-up ("ding"), written by the LedgerLink
 * guild import when a re-export shows a higher level than the stored one.
 * Kept indefinitely (operator ruling 2026-10-28) — the feed reads a window.
 * A multi-level jump is one row; `(guild_member_id, to_level)` is unique so
 * re-applying a snapshot logs nothing twice. `occurred_at` is the snapshot's
 * received instant, not the real ding time (unknown).
 */
export const guildMemberLevelEvents = pgTable(
  'guild_member_level_events',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    guildMemberId: integer('guild_member_id')
      .references(() => guildMembers.id, { onDelete: 'cascade' })
      .notNull(),
    fromLevel: integer('from_level').notNull(),
    toLevel: integer('to_level').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_guild_member_level_events_member_to_level').on(
      table.guildMemberId,
      table.toLevel,
    ),
    // Feed read: one guild's newest dings. Also backs the guild_id FK.
    index('idx_guild_member_level_events_guild_occurred').on(
      table.guildId,
      table.occurredAt.desc(),
    ),
  ],
);

export type GuildMemberLevelEventInsert =
  typeof guildMemberLevelEvents.$inferInsert;
export type GuildMemberLevelEventSelect =
  typeof guildMemberLevelEvents.$inferSelect;
