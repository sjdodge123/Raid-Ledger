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
    /** Discord message ID of the recruitment bump message (ROK-728). Nullable — only set when a bump has been posted. */
    bumpMessageId: varchar('bump_message_id', { length: 255 }),
    /**
     * Discord channel ID where the recruitment bump was actually posted (ROK-1335).
     * Differs from `channelId` when channel bindings changed between initial-embed-post and bump-post:
     * the bump goes to the current resolver-chosen channel, but `channelId` stays on the original
     * embed channel (still the source of truth for editing the original embed).
     * Nullable — only set when a bump has been posted; legacy rows fall back to `channelId` for cleanup.
     */
    bumpChannelId: varchar('bump_channel_id', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('unique_event_channel_message').on(
      table.eventId,
      table.channelId,
      table.messageId,
    ),
    index('idx_discord_event_messages_event').on(table.eventId),
    index('idx_discord_event_messages_message').on(
      table.guildId,
      table.channelId,
      table.messageId,
    ),
  ],
);
