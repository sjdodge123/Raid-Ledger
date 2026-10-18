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
 * ROK-1831: membership rows of a game-server community hub
 * (`guilds.kind = 'game_server'`) — plugin-owned (Pelican).
 *
 * One row per (hub, linked RL user). Membership is computed at read time
 * (spec L-2): manual Join not left, OR seen by presence within the rolling
 * 90-day window. Rows are never deleted on expiry, so first-seen history
 * survives a return. Only users with a matched `users.steam_id` get a row
 * (spec L-7) — bare SteamIDs are never stored.
 */
export const hubServerMembers = pgTable(
  'hub_server_members',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** presence | manual — the last way they qualified. */
    source: varchar('source', {
      length: 10,
      enum: ['presence', 'manual'],
    }).notNull(),
    /** First presence sighting; null = joined manually, never played. */
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    /** Latest presence sighting (transitions + the 10-minute touch). */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Manual Join; null = presence-only. */
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    /** Manual Leave. */
    leftAt: timestamp('left_at', { withTimezone: true }),
    /** Last in-game character name presence saw (spec L-6). */
    characterName: varchar('character_name', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'hub_server_members_source_check',
      sql`${table.source} IN ('presence', 'manual')`,
    ),
    uniqueIndex('idx_hub_server_members_guild_user').on(
      table.guildId,
      table.userId,
    ),
    // ROK-1157: FK backing index for user_id (guild_id leads the unique).
    index('idx_hub_server_members_user_id').on(table.userId),
    index('idx_hub_server_members_guild_last_seen').on(
      table.guildId,
      table.lastSeenAt,
    ),
  ],
);

export type HubServerMemberInsert = typeof hubServerMembers.$inferInsert;
export type HubServerMemberSelect = typeof hubServerMembers.$inferSelect;
