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
 * ROK-1868: a hub's leader posts — a feed that replaces the single
 * `guild_profiles.gm_post` field (kept as legacy, A3). Bodies are markdown
 * source in the hub-post subset; the length CHECK counts source characters.
 * `updated_by` stays NULL until a PATCH changes the body (the "Edited" mark).
 * The relay pair is both-or-neither: a post either reached Discord or not.
 */
export const hubPosts = pgTable(
  'hub_posts',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    authorId: integer('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedBy: integer('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    relayChannelId: varchar('relay_channel_id', { length: 32 }),
    relayMessageId: varchar('relay_message_id', { length: 32 }),
    relayedAt: timestamp('relayed_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'hub_posts_body_length',
      sql`char_length(${table.body}) BETWEEN 1 AND 4000`,
    ),
    check(
      'hub_posts_relay_pair',
      sql`(${table.relayChannelId} IS NULL) = (${table.relayMessageId} IS NULL)`,
    ),
    // Keyset feed order: newest first, id breaks created_at ties.
    index('idx_hub_posts_guild_created').on(
      table.guildId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    // ROK-1157: FK backing indexes.
    index('idx_hub_posts_author_id').on(table.authorId),
    index('idx_hub_posts_updated_by').on(table.updatedBy),
  ],
);

export type HubPostInsert = typeof hubPosts.$inferInsert;
export type HubPostSelect = typeof hubPosts.$inferSelect;
