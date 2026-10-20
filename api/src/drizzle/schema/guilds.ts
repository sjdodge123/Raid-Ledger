import {
  pgTable,
  serial,
  integer,
  bigint,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { games } from './games';
import { pelicanServers } from './pelican-servers';
import { users } from './users';

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
    /**
     * ROK-1830: which hub kind this group is (mirrors contract `GUILD_KINDS`).
     * Every insert path today is WoW, so the default stays (spec Q5).
     */
    kind: varchar('kind', {
      length: 20,
      enum: ['wow_guild', 'game_server', 'game_community'],
    })
      .default('wow_guild')
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
    /** addon_import | blizzard | pelican (ROK-1831 server hubs) */
    source: varchar('source', { length: 20 }).notNull(),
    lastSnapshotAt: timestamp('last_snapshot_at', { withTimezone: true }),
    /** The realm string the addon reported — provenance only, not identity. */
    rawRealm: varchar('raw_realm', { length: 64 }),
    /**
     * ROK-1831: the Pelican server a `game_server` hub is keyed to (1:1).
     * Always null for WoW rows (`guilds_server_kind_check`).
     */
    pelicanServerId: integer('pelican_server_id').references(
      () => pelicanServers.id,
      { onDelete: 'set null' },
    ),
    /** ROK-1831: admin hid the hub — 404 for non-staff, data kept. */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    /**
     * ROK-1870: a community hub's life (proposed → active → archived). Every
     * other kind is always `active` (`guilds_status_kind_check`).
     */
    status: varchar('status', {
      length: 10,
      enum: ['proposed', 'active', 'archived'],
    })
      .default('active')
      .notNull(),
    /** ROK-1870 D10: the short pitch on the directory + game-page cards. */
    blurb: varchar('blurb', { length: 280 }),
    /** ROK-1870 D8: who proposed the community hub. */
    proposedBy: integer('proposed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** ROK-1870 D8: the staff member who approved it. */
    reviewedBy: integer('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** ROK-1870: admin | leader | empty (D13 auto-archive). */
    archivedReason: varchar('archived_reason', {
      length: 10,
      enum: ['admin', 'leader', 'empty'],
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    /**
     * One realm-less WoW guild per (game, region, lower(name)). ROK-1831
     * narrowed it to WoW rows: two servers of one game may share a name.
     * ON CONFLICT callers must repeat this predicate as `targetWhere`.
     */
    uniqueIndex('idx_guilds_realmless_name')
      .on(table.gameId, table.region, table.nameKey)
      .where(sql`${table.realmSlug} IS NULL AND ${table.kind} = 'wow_guild'`),
    /** ROK-1831: one hub per Pelican server. */
    uniqueIndex('idx_guilds_pelican_server')
      .on(table.pelicanServerId)
      .where(sql`${table.pelicanServerId} IS NOT NULL`),
    // ROK-1157: FK backing index — the partial unique above does not count.
    index('idx_guilds_game_id').on(table.gameId),
    index('idx_guilds_pelican_server_id').on(table.pelicanServerId),
    /** ROK-1870 D11: one non-archived community hub per (game, lower(name)). */
    uniqueIndex('idx_guilds_community_name')
      .on(table.gameId, table.nameKey)
      .where(
        sql`${table.kind} = 'game_community' AND ${table.status} <> 'archived'`,
      ),
    index('idx_guilds_proposed_by').on(table.proposedBy),
    index('idx_guilds_reviewed_by').on(table.reviewedBy),
    /** ROK-1870: the directory + the admin proposal queue. */
    index('idx_guilds_kind_status').on(table.kind, table.status),
    check(
      'guilds_kind_check',
      sql`${table.kind} IN ('wow_guild', 'game_server', 'game_community')`,
    ),
    check(
      'guilds_server_kind_check',
      sql`${table.pelicanServerId} IS NULL OR ${table.kind} = 'game_server'`,
    ),
    check(
      'guilds_status_check',
      sql`${table.status} IN ('proposed', 'active', 'archived')`,
    ),
    check(
      'guilds_status_kind_check',
      sql`${table.status} = 'active' OR ${table.kind} = 'game_community'`,
    ),
    check(
      'guilds_community_server_check',
      sql`${table.kind} <> 'game_community' OR ${table.pelicanServerId} IS NULL`,
    ),
  ],
);

export type GuildInsert = typeof guilds.$inferInsert;
export type GuildSelect = typeof guilds.$inferSelect;
