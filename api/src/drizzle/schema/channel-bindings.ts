import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { games } from './games';

/**
 * Channel Bindings - Maps Discord channels to games/behaviors.
 * Used for smart routing of event announcements and voice monitoring.
 * ROK-348: Channel Binding System.
 *
 * No community_id column - the app is single-tenant.
 * guild_id serves as the scope identifier.
 */
export const channelBindings = pgTable(
  'channel_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: varchar('guild_id', { length: 255 }).notNull(),
    channelId: varchar('channel_id', { length: 255 }).notNull(),
    channelType: varchar('channel_type', { length: 50 }).notNull(), // 'text', 'voice'
    bindingPurpose: varchar('binding_purpose', { length: 50 }).notNull(), // 'game-announcements', 'game-voice-monitor', 'general-lobby'
    gameId: integer('game_id').references(() => games.id, {
      onDelete: 'set null',
    }),
    config: jsonb('config').default({}).$type<{
      minPlayers?: number;
      autoClose?: boolean;
      gracePeriod?: number;
    }>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    guildChannelUnique: uniqueIndex('channel_bindings_guild_channel_unique').on(
      table.guildId,
      table.channelId,
    ),
    guildIdx: index('idx_channel_bindings_guild').on(table.guildId),
    gameIdx: index('idx_channel_bindings_game').on(table.gameId),
  }),
);
