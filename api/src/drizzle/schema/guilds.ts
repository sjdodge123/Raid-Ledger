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
import { games } from './games';

/**
 * ROK-1724 (built for ROK-1170): in-game guilds — plugin-owned.
 *
 * Realm-optional so both sources fit: a WoW addon import knows only the guild
 * name (WoW: Forever has no realm, `realm_slug` NULL), the Blizzard sync
 * (ROK-1170) knows the realm + slug + Blizzard id. Realm-less rows are unique
 * on (game, region, lower(name)); ROK-1170 adds its own
 * (game, region, realm_slug, guild_slug) unique for realmed rows.
 */
export const guilds = pgTable(
  'guilds',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    region: varchar('region', { length: 10 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    /** lower(name) — the realm-less identity key. */
    nameKey: varchar('name_key', { length: 64 }).notNull(),
    realmSlug: varchar('realm_slug', { length: 100 }),
    guildSlug: varchar('guild_slug', { length: 100 }),
    blizzardGuildId: bigint('blizzard_guild_id', { mode: 'number' }),
    faction: varchar('faction', { length: 20 }),
    memberCount: integer('member_count').default(0).notNull(),
    /** addon_import | blizzard */
    source: varchar('source', { length: 20 }).notNull(),
    lastSnapshotAt: timestamp('last_snapshot_at', { withTimezone: true }),
    /** The realm string the addon reported — provenance only, not identity. */
    rawRealm: varchar('raw_realm', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    /** One realm-less guild per (game, region, lower(name)). */
    uniqueIndex('idx_guilds_realmless_name')
      .on(table.gameId, table.region, table.nameKey)
      .where(sql`${table.realmSlug} IS NULL`),
    // ROK-1157: FK backing index — the partial unique above does not count.
    index('idx_guilds_game_id').on(table.gameId),
  ],
);

export type GuildInsert = typeof guilds.$inferInsert;
export type GuildSelect = typeof guilds.$inferSelect;
