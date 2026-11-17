import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  boolean,
  smallint,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';
import { hubForumReplies, hubForumThreads } from './hub-forum';

/**
 * ROK-2208: a Discord forum channel the hub Forum syncs with. One row per
 * channel; several hubs may bind the same channel (each with its own tag), so
 * the channel is unique here and NOT on the binding. `webhook_token_enc` holds
 * the bot-created webhook's token, encrypted at rest (never plaintext).
 */
export const hubForumDiscordForums = pgTable('hub_forum_discord_forums', {
  id: serial('id').primaryKey(),
  discordGuildId: varchar('discord_guild_id', { length: 32 }).notNull(),
  channelId: varchar('channel_id', { length: 32 }).notNull().unique(),
  /** True when the bot created the channel (it may delete it on unlink). */
  managed: boolean('managed').notNull().default(false),
  webhookId: varchar('webhook_id', { length: 32 }),
  webhookTokenEnc: text('webhook_token_enc'),
  /** The bot turned on Discord's "Require tags" (second hub bound). */
  requireTagSet: boolean('require_tag_set').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * ROK-2208: a hub's binding to a Discord forum. Unique on the HUB (the PK);
 * a shared forum carries one row per hub, told apart by `tag_id`.
 */
export const hubForumDiscordBindings = pgTable(
  'hub_forum_discord_bindings',
  {
    guildId: integer('guild_id')
      .primaryKey()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    forumId: integer('forum_id').notNull(),
    /** The hub's forum tag; null while the forum serves one hub only. */
    tagId: varchar('tag_id', { length: 32 }),
    ackBy: integer('ack_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ackAt: timestamp('ack_at', { withTimezone: true }).notNull(),
    /** Sync starts here; Discord threads older than this never import. */
    boundAt: timestamp('bound_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_hub_forum_discord_bindings_forum_tag')
      .on(table.forumId, table.tagId)
      .where(sql`${table.tagId} IS NOT NULL`),
    index('idx_hub_forum_discord_bindings_forum_id').on(table.forumId),
    index('idx_hub_forum_discord_bindings_ack_by').on(table.ackBy),
    // ROK-1387: drizzle's default name is 66 chars; Postgres truncates at 63.
    foreignKey({
      columns: [table.forumId],
      foreignColumns: [hubForumDiscordForums.id],
      name: 'hub_forum_discord_bindings_forum_id_fk',
    }).onDelete('cascade'),
  ],
);

/** The link table's value checks (kept apart to keep the table short). */
function linkChecks(table: {
  kind: AnyPgColumn;
  replyId: AnyPgColumn;
  origin: AnyPgColumn;
  syncState: AnyPgColumn;
}) {
  return [
    check(
      'hub_forum_discord_links_kind',
      sql`${table.kind} IN ('thread', 'reply')`,
    ),
    check(
      'hub_forum_discord_links_kind_reply',
      sql`(${table.kind} = 'reply') = (${table.replyId} IS NOT NULL)`,
    ),
    check(
      'hub_forum_discord_links_origin',
      sql`${table.origin} IN ('raidledger', 'discord')`,
    ),
    check(
      'hub_forum_discord_links_sync_state',
      sql`${table.syncState} IN ('pending', 'synced', 'failed')`,
    ),
  ];
}

/**
 * ROK-2208: one RL thread/reply ↔ one Discord message. A thread's link points
 * at the forum post's starter message; a reply's at its own message.
 */
export const hubForumDiscordLinks = pgTable(
  'hub_forum_discord_links',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 8 }).notNull(),
    threadId: integer('thread_id')
      .notNull()
      .references(() => hubForumThreads.id, { onDelete: 'cascade' }),
    replyId: integer('reply_id').references(() => hubForumReplies.id, {
      onDelete: 'cascade',
    }),
    discordThreadId: varchar('discord_thread_id', { length: 32 }).notNull(),
    discordMessageId: varchar('discord_message_id', { length: 32 })
      .notNull()
      .unique(),
    origin: varchar('origin', { length: 12 }).notNull(),
    syncState: varchar('sync_state', { length: 8 }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    discordDeletedAt: timestamp('discord_deleted_at', { withTimezone: true }),
    discordLockedAt: timestamp('discord_locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    ...linkChecks(table),
    uniqueIndex('uq_hub_forum_discord_links_thread')
      .on(table.threadId)
      .where(sql`${table.kind} = 'thread'`),
    uniqueIndex('uq_hub_forum_discord_links_reply').on(table.replyId),
    index('idx_hub_forum_discord_links_retry')
      .on(table.syncState)
      .where(
        sql`${table.origin} = 'raidledger' AND ${table.syncState} <> 'synced'`,
      ),
    index('idx_hub_forum_discord_links_guild_id').on(table.guildId),
    // ROK-1157: the partial unique index above cannot serve the FK's RI scan.
    index('idx_hub_forum_discord_links_thread_id').on(table.threadId),
    index('idx_hub_forum_discord_links_discord_thread').on(
      table.discordThreadId,
    ),
  ],
);

/**
 * ROK-2208 OQ-4: a shared forum's post that is not synced (untagged or more
 * than one hub tag) gets ONE bot reply. The row is the "already told" record:
 * the bot sends only when its `INSERT … ON CONFLICT DO NOTHING` returns a
 * row, so restarts, reconcile and races never double-post.
 */
export const hubForumDiscordNotices = pgTable(
  'hub_forum_discord_notices',
  {
    discordThreadId: varchar('discord_thread_id', { length: 32 }).primaryKey(),
    forumId: integer('forum_id').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_hub_forum_discord_notices_forum_id').on(table.forumId),
    // ROK-1387: drizzle's default name is 65 chars; Postgres truncates at 63.
    foreignKey({
      columns: [table.forumId],
      foreignColumns: [hubForumDiscordForums.id],
      name: 'hub_forum_discord_notices_forum_id_fk',
    }).onDelete('cascade'),
  ],
);

export type HubForumDiscordForumSelect =
  typeof hubForumDiscordForums.$inferSelect;
export type HubForumDiscordForumInsert =
  typeof hubForumDiscordForums.$inferInsert;
export type HubForumDiscordBindingSelect =
  typeof hubForumDiscordBindings.$inferSelect;
export type HubForumDiscordBindingInsert =
  typeof hubForumDiscordBindings.$inferInsert;
export type HubForumDiscordLinkSelect =
  typeof hubForumDiscordLinks.$inferSelect;
export type HubForumDiscordLinkInsert =
  typeof hubForumDiscordLinks.$inferInsert;
