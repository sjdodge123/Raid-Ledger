import {
  pgTable,
  integer,
  text,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { GuildLinkGroup, GuildRuleSection } from '@raid-ledger/contract';
import { guilds } from './guilds';
import { users } from './users';

/**
 * ROK-1786 (S2 of ROK-1781): one editable profile per guild — the GM post,
 * rules and links. Plugin-owned. Later stories (S4 Discord mirror, S5
 * recruitment) add their columns in their own migrations.
 */
export const guildProfiles = pgTable(
  'guild_profiles',
  {
    guildId: integer('guild_id')
      .primaryKey()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    gmPost: text('gm_post'),
    gmPostUpdatedAt: timestamp('gm_post_updated_at', { withTimezone: true }),
    gmPostUpdatedBy: integer('gm_post_updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Ordered rule sections; null = never edited. */
    rules: jsonb('rules').$type<GuildRuleSection[]>(),
    /** Ordered link groups; null = never edited. */
    links: jsonb('links').$type<GuildLinkGroup[]>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'guild_profiles_gm_post_length',
      sql`char_length(${table.gmPost}) <= 4000`,
    ),
    // ROK-1157: FK backing index (guild_id is the PK).
    index('idx_guild_profiles_gm_post_updated_by').on(table.gmPostUpdatedBy),
  ],
);

export type GuildProfileInsert = typeof guildProfiles.$inferInsert;
export type GuildProfileSelect = typeof guildProfiles.$inferSelect;
