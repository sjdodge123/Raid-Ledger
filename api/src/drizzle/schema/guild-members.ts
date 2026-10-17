import {
  pgTable,
  serial,
  integer,
  bigint,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';

/**
 * ROK-1724 (built for ROK-1170): guild roster rows — plugin-owned.
 *
 * There is deliberately NO officer-note column, ever (operator data rule
 * 2026-10-04). `public_note` is only set when the player opted in addon-side.
 * No claimed-character column either: the RL link is derived by joining
 * `guid` to `characters.addon_guid`, so nothing is auto-claimed.
 */
export const guildMembers = pgTable(
  'guild_members',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    /** In-game GUID (addon source); null for Blizzard-only rows. */
    guid: varchar('guid', { length: 32 }),
    blizzardCharacterId: bigint('blizzard_character_id', { mode: 'number' }),
    characterName: varchar('character_name', { length: 100 }).notNull(),
    level: integer('level'),
    class: varchar('class', { length: 50 }),
    rankIndex: integer('rank_index'),
    rankName: varchar('rank_name', { length: 64 }),
    publicNote: varchar('public_note', { length: 256 }),
    /** addon_import | blizzard */
    source: varchar('source', { length: 20 }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    capturedByUserId: integer('captured_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    /** One row per in-game character per guild. */
    uniqueIndex('idx_guild_members_guild_guid')
      .on(table.guildId, table.guid)
      .where(sql`${table.guid} IS NOT NULL`),
    // ROK-1157: FK backing indexes — the partial unique above does not count.
    index('idx_guild_members_guild_id').on(table.guildId),
    index('idx_guild_members_captured_by_user_id').on(table.capturedByUserId),
  ],
);

export type GuildMemberInsert = typeof guildMembers.$inferInsert;
export type GuildMemberSelect = typeof guildMembers.$inferSelect;
