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
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  GuildLinkGroup,
  GuildRuleSection,
  HubWidgetPrefs,
} from '@raid-ledger/contract';
import { guilds } from './guilds';
import { users } from './users';

/** ROK-2136: in-game text caps (char_length <= the UTF-16 Zod cap, D3) + FK indexes. */
function ingameTextConstraints(table: {
  ingameMotd: AnyPgColumn;
  ingameInfo: AnyPgColumn;
  ingameMotdUpdatedBy: AnyPgColumn;
  ingameInfoUpdatedBy: AnyPgColumn;
}) {
  return [
    check(
      'guild_profiles_ingame_motd_length',
      sql`char_length(${table.ingameMotd}) <= 255`,
    ),
    check(
      'guild_profiles_ingame_info_length',
      sql`char_length(${table.ingameInfo}) <= 499`,
    ),
    index('idx_guild_profiles_ingame_motd_updated_by').on(
      table.ingameMotdUpdatedBy,
    ),
    index('idx_guild_profiles_ingame_info_updated_by').on(
      table.ingameInfoUpdatedBy,
    ),
  ];
}

/** ROK-2137: the text reported from the game obeys the same in-game caps. */
function gameTextConstraints(table: {
  gameMotd: AnyPgColumn;
  gameInfo: AnyPgColumn;
}) {
  return [
    check(
      'guild_profiles_game_motd_length',
      sql`char_length(${table.gameMotd}) <= 255`,
    ),
    check(
      'guild_profiles_game_info_length',
      sql`char_length(${table.gameInfo}) <= 499`,
    ),
  ];
}

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
    /**
     * ROK-1429 (D7): who set the channel — 'auto' (the lifecycle reconciler
     * linked a managed game channel) or 'manual' (a Leader set or cleared it,
     * which the reconciler never overwrites). NULL = never set.
     */
    discordChannelSource: varchar('discord_channel_source', {
      length: 6,
    }).$type<'auto' | 'manual'>(),
    /**
     * ROK-1933 (D10): where the hub welcome embed was last posted, and its
     * message id — so a re-link or re-post EDITS the pinned message instead
     * of duplicating it. NULL = never posted (or cleared with the channel).
     */
    welcomeChannelId: text('welcome_channel_id'),
    welcomeMessageId: text('welcome_message_id'),
    /** ROK-1868 A4: the composer's "Also post to Discord" default (last choice). */
    postRelayDefault: boolean('post_relay_default').default(false).notNull(),
    /**
     * ROK-1918: the hub Overview layout (arrange mode) — order, hidden,
     * added and per-widget config. NULL = registry default (Reset writes it).
     */
    widgetPrefs: jsonb('widget_prefs').$type<HubWidgetPrefs>(),
    /**
     * ROK-1941 (D1): the Discord channel whose screenshot-mod posts feed the
     * hub gallery (+ death links). Leader-set; one channel feeds one hub.
     */
    mediaChannelId: varchar('media_channel_id', { length: 32 }),
    mediaChannelSetBy: integer('media_channel_set_by').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    mediaChannelSetAt: timestamp('media_channel_set_at', {
      withTimezone: true,
    }),
    /**
     * ROK-2136 (D1): the WoW: Forever guild Message of the Day and Guild
     * Information, copied into the in-game boxes. Per-field timestamps drive
     * the per-field 409 (D6) and ROK-2137's drift compare. NULL = never set
     * or cleared. Caps mirror WOW_GUILD_MOTD_MAX / WOW_GUILD_INFO_MAX.
     */
    ingameMotd: text('ingame_motd'),
    ingameMotdUpdatedAt: timestamp('ingame_motd_updated_at', {
      withTimezone: true,
    }),
    ingameMotdUpdatedBy: integer('ingame_motd_updated_by').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    ingameInfo: text('ingame_info'),
    ingameInfoUpdatedAt: timestamp('ingame_info_updated_at', {
      withTimezone: true,
    }),
    ingameInfoUpdatedBy: integer('ingame_info_updated_by').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    /**
     * ROK-2137 (P1): the text LedgerLink last REPORTED from the game (never
     * the hub's own text above). `*_reported_at` = the export's snapshot
     * instant; set + NULL text = the in-game box was reported empty. Only
     * a report not older than the stored one lands. `*_acknowledged_at` =
     * an officer chose Push (keep the hub text); a NEWER report differing
     * again re-raises "Changed in game".
     */
    gameMotd: text('game_motd'),
    gameMotdReportedAt: timestamp('game_motd_reported_at', {
      withTimezone: true,
    }),
    gameMotdAcknowledgedAt: timestamp('game_motd_acknowledged_at', {
      withTimezone: true,
    }),
    gameInfo: text('game_info'),
    gameInfoReportedAt: timestamp('game_info_reported_at', {
      withTimezone: true,
    }),
    gameInfoAcknowledgedAt: timestamp('game_info_acknowledged_at', {
      withTimezone: true,
    }),
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
    check(
      'guild_profiles_discord_channel_source_check',
      sql`${table.discordChannelSource} IN ('auto', 'manual')`,
    ),
    // ROK-1157: FK backing index (guild_id is the PK).
    index('idx_guild_profiles_gm_post_updated_by').on(table.gmPostUpdatedBy),
    index('idx_guild_profiles_discord_channel_set_by').on(
      table.discordChannelSetBy,
    ),
    // ROK-1941 (D1): one media channel feeds exactly one hub.
    uniqueIndex('guild_profiles_media_channel_uq')
      .on(table.mediaChannelId)
      .where(sql`${table.mediaChannelId} IS NOT NULL`),
    index('idx_guild_profiles_media_channel_set_by').on(
      table.mediaChannelSetBy,
    ),
    ...ingameTextConstraints(table),
    ...gameTextConstraints(table),
  ],
);

export type GuildProfileInsert = typeof guildProfiles.$inferInsert;
export type GuildProfileSelect = typeof guildProfiles.$inferSelect;
