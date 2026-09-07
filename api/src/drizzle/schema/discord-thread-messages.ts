import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** One `{name, url}` attachment as mirrored from Discord (ROK-1483). */
export interface MirroredAttachment {
  name: string;
  url: string;
}

/** One mention resolved at write time (ROK-1483 D8). */
export interface MirroredMention {
  id: string;
  kind: 'user' | 'role' | 'channel';
  displayName: string;
}

/**
 * Messages mirrored out of a Discord thread so the web app can render a
 * conversation without ever calling Discord on the request path (ROK-1483 D1).
 *
 * **Deliberately surface-agnostic — there is NO foreign key to
 * `lfg_group_messages`.** ROK-1484 mirrors lineup, poll and event threads into
 * this same table; an FK would bind it to LFG forever and force a second table
 * the first time another surface arrives.
 *
 * `sort_key` exists because Discord snowflakes are decimal STRINGS and are not
 * lexicographically ordered — `'9…'` sorts after `'10…'`, so `ORDER BY
 * message_id` and a varchar `>` cursor are both silently wrong the moment ids
 * cross a digit boundary (D5). Snowflakes are below 2^63, so a signed bigint is
 * exact and monotonic in time.
 *
 * Deletes are SOFT (`deleted_at`, D10): the row keeps `message_id` occupied so
 * a re-delivered gateway event or a later backfill cannot resurrect a message
 * the author removed. That is what makes the backfill idempotent under delete.
 */
export const discordThreadMessages = pgTable(
  'discord_thread_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The Discord thread (forum post) this message lives in. */
    threadId: varchar('thread_id', { length: 255 }).notNull(),
    /** Kept on the row so the Open-in-Discord url needs no live client. */
    guildId: varchar('guild_id', { length: 255 }).notNull(),
    messageId: varchar('message_id', { length: 255 }).notNull(),
    /** `BigInt(message.id)` — the only ordering and cursor column (D5). */
    sortKey: bigint('sort_key', { mode: 'bigint' }).notNull(),
    authorDiscordId: varchar('author_discord_id', { length: 255 }).notNull(),
    /** Frozen at post time — a later rename must not rewrite history. */
    authorDisplayName: varchar('author_display_name', {
      length: 255,
    }).notNull(),
    /** Frozen at post time; null renders as initials. */
    authorAvatarHash: varchar('author_avatar_hash', { length: 255 }),
    /** Empty for an attachment-only message. */
    content: text('content').default('').notNull(),
    attachments: jsonb('attachments')
      .$type<MirroredAttachment[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    mentions: jsonb('mentions')
      .$type<MirroredMention[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    discordCreatedAt: timestamp('discord_created_at').notNull(),
    editedAt: timestamp('edited_at'),
    /** Soft delete (D10) — omitted from the API response entirely. */
    deletedAt: timestamp('deleted_at'),
    /**
     * Touched on every mirror write. Unused by v1's read path; it is the
     * column a `?since=<ISO>` delta would key on (A4), which is the only
     * cursor shape that can observe an edit or a delete.
     */
    mirrorUpdatedAt: timestamp('mirror_updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Explicit index names: Postgres truncates identifiers past 63 chars
    // SILENTLY, so drizzle's generated composite names can diverge from the
    // database's (the trap documented on `lfg_group_messages`).
    /** AC2's idempotency — the conflict target every mirror write uses. */
    uniqueIndex('uq_discord_thread_messages_message').on(table.messageId),
    /** The ONLY read pattern: one thread, ascending by snowflake. */
    index('idx_discord_thread_messages_thread').on(
      table.threadId,
      table.sortKey,
    ),
  ],
);
