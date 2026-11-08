import {
  pgTable,
  serial,
  integer,
  bigint,
  varchar,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import type {
  GuildMailworthyStoredDays,
  GuildMailworthyStoredRules,
} from '@raid-ledger/contract';
import { guilds } from './guilds';
import { users } from './users';

/**
 * ROK-2148 D.1: guild-level Mailworthy data lifted from LedgerLink char
 * exports. Three tables, three merge rules: template (newest `rev` wins),
 * peers (max `last_seen_at`), givers (latest `as_of` wins). Plugin-owned —
 * only `plugins/wow-common` reads or writes them. Stored jsonb is re-parsed
 * on read with the contract `GuildMailworthyStored*Schema`, never trusted raw.
 * `name_key` is the normalized character name; the read side matches it
 * against the latest guild roster to roll alts up to their RL user and to
 * drop givers no longer on the roster (operator round 2).
 */

/** One shared template per guild; `rev` (unix seconds) is its identity. */
export const guildMailworthyTemplates = pgTable(
  'guild_mailworthy_templates',
  {
    guildId: integer('guild_id')
      .primaryKey()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    rev: bigint('rev', { mode: 'number' }).notNull(),
    authorName: varchar('author_name', { length: 100 }).notNull(),
    rules: jsonb('rules').$type<GuildMailworthyStoredRules>().notNull(),
    reportedByUserId: integer('reported_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // ROK-1157: FK backing index.
    index('idx_guild_mailworthy_templates_reported_by').on(
      table.reportedByUserId,
    ),
  ],
);

/** Guild members seen running Mailworthy (pruned after 90 days). */
export const guildMailworthyPeers = pgTable(
  'guild_mailworthy_peers',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    nameKey: varchar('name_key', { length: 100 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('uq_guild_mailworthy_peers_guild_name').on(
      table.guildId,
      table.nameKey,
    ),
    index('idx_guild_mailworthy_peers_guild_seen').on(
      table.guildId,
      table.lastSeenAt,
    ),
  ],
);

/** Per sending character: self-reported contribution counts. */
export const guildMailworthyGivers = pgTable(
  'guild_mailworthy_givers',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    nameKey: varchar('name_key', { length: 100 }).notNull(),
    characterName: varchar('character_name', { length: 100 }).notNull(),
    itemsAllTime: integer('items_all_time').notNull(),
    countingSince: timestamp('counting_since', {
      withTimezone: true,
    }).notNull(),
    /** Daily buckets, ≤ 35 entries. */
    days: jsonb('days').$type<GuildMailworthyStoredDays>().notNull(),
    /** Export `generatedAt` clamped to now — the latest-wins key. */
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    reportedByUserId: integer('reported_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('uq_guild_mailworthy_givers_guild_name').on(
      table.guildId,
      table.nameKey,
    ),
    // ROK-1157: FK backing index.
    index('idx_guild_mailworthy_givers_reported_by').on(table.reportedByUserId),
  ],
);

export type GuildMailworthyTemplateRow =
  typeof guildMailworthyTemplates.$inferSelect;
export type GuildMailworthyPeerRow = typeof guildMailworthyPeers.$inferSelect;
export type GuildMailworthyGiverRow = typeof guildMailworthyGivers.$inferSelect;
