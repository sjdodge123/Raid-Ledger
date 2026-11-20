import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  index,
  check,
  type AnyPgColumn,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';

/**
 * ROK-2208: the Discord author of a row synced in from a Discord forum. Set on
 * every Discord-origin row; while `author_id` is null the row is a guest post
 * ("via Discord"). Linking that Discord account later claims the row
 * (`author_id` filled, these kept). `author_discord_avatar` is the avatar hash.
 */
function discordGuestColumns() {
  return {
    authorDiscordId: varchar('author_discord_id', { length: 32 }),
    authorDiscordName: varchar('author_discord_name', { length: 100 }),
    authorDiscordAvatar: varchar('author_discord_avatar', { length: 64 }),
  };
}

/** ROK-2208: claim-on-link looks guest rows up by Discord id. */
function discordIdIndex(table: 'threads' | 'replies', column: AnyPgColumn) {
  return index(`idx_hub_forum_${table}_author_discord_id`)
    .on(column)
    .where(sql`${column} IS NOT NULL`);
}

/**
 * ROK-2226 + ROK-2272: discussion-thread constraints — a thread discusses at
 * most one subject (event, scheduling poll or lineup), one live thread each.
 */
function subjectChecks(table: {
  eventId: AnyPgColumn;
  matchId: AnyPgColumn;
  lineupId: AnyPgColumn;
  eventDetachedAt: AnyPgColumn;
  writeClosesAt: AnyPgColumn;
}) {
  return [
    // ROK-2226: event discussion threads — one live thread per event.
    // ROK-2272: loosened from event-only so poll/lineup threads reuse them.
    check(
      'hub_forum_threads_event_detached',
      sql`${table.eventDetachedAt} IS NULL OR num_nonnulls(${table.eventId}, ${table.matchId}, ${table.lineupId}) = 1`,
    ),
    check(
      'hub_forum_threads_write_closes',
      sql`${table.writeClosesAt} IS NULL OR num_nonnulls(${table.eventId}, ${table.matchId}, ${table.lineupId}) = 1`,
    ),
    check(
      'hub_forum_threads_one_subject',
      sql`num_nonnulls(${table.eventId}, ${table.matchId}, ${table.lineupId}) <= 1`,
    ),
  ];
}

/** ROK-2226 + ROK-2272: one live discussion thread per subject. */
function subjectIndexes(table: {
  eventId: AnyPgColumn;
  matchId: AnyPgColumn;
  lineupId: AnyPgColumn;
  eventDetachedAt: AnyPgColumn;
}) {
  return [
    uniqueIndex('uq_hub_forum_threads_event_live')
      .on(table.eventId)
      .where(
        sql`${table.eventId} IS NOT NULL AND ${table.eventDetachedAt} IS NULL`,
      ),
    index('idx_hub_forum_threads_event_id')
      .on(table.eventId)
      .where(sql`${table.eventId} IS NOT NULL`),
    // ROK-2272: one live thread per scheduling poll / lineup.
    uniqueIndex('uq_hub_forum_threads_match_live')
      .on(table.matchId)
      .where(
        sql`${table.matchId} IS NOT NULL AND ${table.eventDetachedAt} IS NULL`,
      ),
    uniqueIndex('uq_hub_forum_threads_lineup_live')
      .on(table.lineupId)
      .where(
        sql`${table.lineupId} IS NOT NULL AND ${table.eventDetachedAt} IS NULL`,
      ),
  ];
}

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
    ...discordGuestColumns(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    // ROK-2226: event discussion threads. No FK on event_id (spec D1): a
    // series delete emits DELETED after the event rows are gone.
    eventId: integer('event_id'),
    // ROK-2272: scheduling-poll (lineup match) and lineup discussion threads,
    // no FK either. A thread discusses at most one subject.
    matchId: integer('match_id'),
    lineupId: integer('lineup_id'),
    // ROK-2272 R8: "subject detached" — reused for poll/lineup threads (the
    // column keeps its ROK-2226 name).
    eventDetachedAt: timestamp('event_detached_at', { withTimezone: true }),
    writeClosesAt: timestamp('write_closes_at', { withTimezone: true }),
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
    discordIdIndex('threads', table.authorDiscordId),
    ...subjectChecks(table),
    ...subjectIndexes(table),
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
    ...discordGuestColumns(),
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
    discordIdIndex('replies', table.authorDiscordId),
  ],
);

export type HubForumThreadSelect = typeof hubForumThreads.$inferSelect;
export type HubForumThreadInsert = typeof hubForumThreads.$inferInsert;
export type HubForumReplySelect = typeof hubForumReplies.$inferSelect;
export type HubForumReplyInsert = typeof hubForumReplies.$inferInsert;
