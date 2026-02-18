import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { events } from './events';

/**
 * Tracks which Discord messages correspond to which events.
 * Enables in-place editing (ROK-119) and cleanup on deletion.
 */
export const discordEventMessages = pgTable(
  'discord_event_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    guildId: varchar('guild_id', { length: 255 }).notNull(),
    channelId: varchar('channel_id', { length: 255 }).notNull(),
    messageId: varchar('message_id', { length: 255 }).notNull(),
    /** Embed lifecycle state: posted | filling | full | imminent | live | completed | cancelled */
    embedState: varchar('embed_state', { length: 30 })
      .notNull()
      .default('posted'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('unique_event_guild').on(table.eventId, table.guildId),
    index('idx_discord_event_messages_event').on(table.eventId),
    index('idx_discord_event_messages_message').on(
      table.guildId,
      table.channelId,
      table.messageId,
    ),
  ],
);
