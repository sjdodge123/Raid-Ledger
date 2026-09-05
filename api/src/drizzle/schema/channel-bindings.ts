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
import { sql } from 'drizzle-orm';
import { games } from './games';

/**
 * Channel Bindings - Maps Discord channels to games/behaviors.
 * Used for smart routing of event announcements and voice monitoring.
 * ROK-348: Channel Binding System.
 * ROK-435: Added recurrence_group_id for series-specific channel bindings.
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
    channelType: varchar('channel_type', { length: 50 }).notNull(), // 'text', 'voice', 'forum' (ROK-1471)
    bindingPurpose: varchar('binding_purpose', { length: 50 }).notNull(), // 'game-announcements', 'game-voice-monitor', 'general-lobby', 'lfg-board'
    gameId: integer('game_id').references(() => games.id, {
      onDelete: 'set null',
    }),
    /** ROK-435: Optional recurrence group ID to bind a specific event series to this channel. */
    recurrenceGroupId: uuid('recurrence_group_id'),
    config: jsonb('config').default({}).$type<{
      minPlayers?: number;
      autoClose?: boolean;
      gracePeriod?: number;
    }>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('channel_bindings_guild_channel_series_unique').on(
      table.guildId,
      table.channelId,
      table.recurrenceGroupId,
    ),
    index('idx_channel_bindings_guild').on(table.guildId),
    index('idx_channel_bindings_game').on(table.gameId),
    index('idx_channel_bindings_recurrence_group').on(table.recurrenceGroupId),
    // ROK-1419: restore duplicate protection for NON-series bindings that
    // migration 0067 dropped (its 3-column key's nullable recurrence_group_id
    // made NULL != NULL erase all protection). Two ADDITIVE partial unique
    // indexes keyed on binding_purpose. The 0067 index is untouched.
    //
    // PERMITTED by construction (never over-rejected):
    //   - two game-voice-monitor rows for DIFFERENT games (ROK-842) — game_id
    //     is part of the game-partial key.
    //   - monitor(game) + general-lobby(NULL) on one channel (prod #Gamer
    //     Night) — they live in DIFFERENT partial indexes (game-not-null vs
    //     null-game).
    //   - any series row (recurrence_group_id IS NOT NULL) — excluded from
    //     both predicates; the 0067 index governs series uniqueness.
    // REJECTED: a second row sharing (guild, channel, purpose, game) among
    //   non-series rows, and two null-game rows of the same purpose.
    uniqueIndex('channel_bindings_nonseries_game_unique')
      .on(table.guildId, table.channelId, table.bindingPurpose, table.gameId)
      .where(
        sql`${table.recurrenceGroupId} IS NULL AND ${table.gameId} IS NOT NULL`,
      ),
    uniqueIndex('channel_bindings_nonseries_nullgame_unique')
      .on(table.guildId, table.channelId, table.bindingPurpose)
      .where(
        sql`${table.recurrenceGroupId} IS NULL AND ${table.gameId} IS NULL`,
      ),
  ],
);
