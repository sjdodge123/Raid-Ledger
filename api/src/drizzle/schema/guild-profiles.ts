import {
  pgTable,
  integer,
  text,
  varchar,
  boolean,
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
    /**
     * ROK-1788 (S4): the ONE Discord channel mirrored on the guild page. Only
     * the binding is stored — message content never is (fetch-on-read).
     */
    discordChannelId: varchar('discord_channel_id', { length: 32 }),
    /** An editor acknowledged that a private channel is shown to every viewer. */
    discordChannelPrivateAck: boolean('discord_channel_private_ack')
      .default(false)
      .notNull(),
    discordChannelSetBy: integer('discord_channel_set_by').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    discordChannelSetAt: timestamp('discord_channel_set_at', {
      withTimezone: true,
    }),
    /** ROK-1868 A4: the composer's "Also post to Discord" default (last choice). */
    postRelayDefault: boolean('post_relay_default').default(false).notNull(),
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
    index('idx_guild_profiles_discord_channel_set_by').on(
      table.discordChannelSetBy,
    ),
  ],
);

export type GuildProfileInsert = typeof guildProfiles.$inferInsert;
export type GuildProfileSelect = typeof guildProfiles.$inferSelect;
