import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hubForumDiscordForums } from './hub-forum-discord';

/**
 * ROK-2272: a Discord-only post in the `event-planning` forum for a subject
 * with no hub (event, scheduling poll or lineup). Nothing syncs back to Raid
 * Ledger; hub subjects keep using `hub_forum_discord_links`. No FK on
 * `subject_id` (mirrors ROK-2226 D1): it is an events / lineup-matches /
 * lineups id depending on `subject_kind`, and series deletes emit after the
 * rows are gone. One live post per subject until the bot deletes it.
 */
export const eventPlanningPosts = pgTable(
  'event_planning_posts',
  {
    id: serial('id').primaryKey(),
    subjectKind: text('subject_kind').notNull(),
    subjectId: integer('subject_id').notNull(),
    forumId: integer('forum_id').notNull(),
    discordThreadId: varchar('discord_thread_id', { length: 32 })
      .notNull()
      .unique('uq_event_planning_posts_discord_thread_id'),
    /** When the bot closes (archives + locks) the post; null = not yet known. */
    closesAt: timestamp('closes_at', { withTimezone: true }),
    discordLockedAt: timestamp('discord_locked_at', { withTimezone: true }),
    discordDeletedAt: timestamp('discord_deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'event_planning_posts_subject_kind',
      sql`${table.subjectKind} IN ('event', 'poll', 'lineup')`,
    ),
    uniqueIndex('uq_event_planning_posts_subject_live')
      .on(table.subjectKind, table.subjectId)
      .where(sql`${table.discordDeletedAt} IS NULL`),
    index('idx_event_planning_posts_forum_id').on(table.forumId),
    index('idx_event_planning_posts_closes_at')
      .on(table.closesAt)
      .where(sql`${table.discordLockedAt} IS NULL`),
    // ROK-1387: keep the FK name short and explicit (≤63 chars).
    foreignKey({
      columns: [table.forumId],
      foreignColumns: [hubForumDiscordForums.id],
      name: 'event_planning_posts_forum_id_fk',
    }).onDelete('cascade'),
  ],
);

export type EventPlanningPostSelect = typeof eventPlanningPosts.$inferSelect;
export type EventPlanningPostInsert = typeof eventPlanningPosts.$inferInsert;
