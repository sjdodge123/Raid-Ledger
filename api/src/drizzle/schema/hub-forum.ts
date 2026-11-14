import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';

/**
 * ROK-1175: a hub's forum threads (Core plugin, every hub kind). Bodies are
 * markdown source in the hub-post subset. Soft delete keeps the row: the API
 * blanks title/body in responses, never in the DB. `reply_count` and
 * `last_activity_at` are maintained by the service in the reply transaction.
 */
export const hubForumThreads = pgTable(
  'hub_forum_threads',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    authorId: integer('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    title: varchar('title', { length: 120 }).notNull(),
    body: text('body').notNull(),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    pinnedBy: integer('pinned_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    replyCount: integer('reply_count').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    deletedAs: varchar('deleted_as', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'hub_forum_threads_title_length',
      sql`char_length(${table.title}) BETWEEN 1 AND 120`,
    ),
    check(
      'hub_forum_threads_body_length',
      sql`char_length(${table.body}) BETWEEN 1 AND 4000`,
    ),
    check('hub_forum_threads_reply_count', sql`${table.replyCount} >= 0`),
    check(
      'hub_forum_threads_deleted_as',
      sql`${table.deletedAs} IN ('author', 'moderator')`,
    ),
    check(
      'hub_forum_threads_deleted_pair',
      sql`(${table.deletedAt} IS NULL) = (${table.deletedAs} IS NULL)`,
    ),
    // Keyset feed: latest activity first, id breaks ties.
    index('idx_hub_forum_threads_feed').on(
      table.guildId,
      table.lastActivityAt.desc(),
      table.id.desc(),
    ),
    index('idx_hub_forum_threads_pinned')
      .on(table.guildId, table.pinnedAt.desc())
      .where(sql`${table.pinnedAt} IS NOT NULL`),
    // ROK-1157: FK backing indexes.
    index('idx_hub_forum_threads_author_id').on(table.authorId),
    index('idx_hub_forum_threads_pinned_by').on(table.pinnedBy),
    index('idx_hub_forum_threads_deleted_by').on(table.deletedBy),
  ],
);

/**
 * ROK-1175: flat replies to a forum thread, oldest first. `guild_id` is
 * denormalised so guards and the user-delete sweep need no join.
 */
export const hubForumReplies = pgTable(
  'hub_forum_replies',
  {
    id: serial('id').primaryKey(),
    threadId: integer('thread_id')
      .notNull()
      .references(() => hubForumThreads.id, { onDelete: 'cascade' }),
    guildId: integer('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    authorId: integer('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: integer('deleted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    deletedAs: varchar('deleted_as', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'hub_forum_replies_body_length',
      sql`char_length(${table.body}) BETWEEN 1 AND 4000`,
    ),
    check(
      'hub_forum_replies_deleted_as',
      sql`${table.deletedAs} IN ('author', 'moderator')`,
    ),
    check(
      'hub_forum_replies_deleted_pair',
      sql`(${table.deletedAt} IS NULL) = (${table.deletedAs} IS NULL)`,
    ),
    // Reply page: oldest first, id breaks ties.
    index('idx_hub_forum_replies_thread').on(
      table.threadId,
      table.createdAt,
      table.id,
    ),
    // ROK-1157: FK backing indexes.
    index('idx_hub_forum_replies_guild_id').on(table.guildId),
    index('idx_hub_forum_replies_author_id').on(table.authorId),
    index('idx_hub_forum_replies_deleted_by').on(table.deletedBy),
  ],
);

export type HubForumThreadSelect = typeof hubForumThreads.$inferSelect;
export type HubForumThreadInsert = typeof hubForumThreads.$inferInsert;
export type HubForumReplySelect = typeof hubForumReplies.$inferSelect;
export type HubForumReplyInsert = typeof hubForumReplies.$inferInsert;
