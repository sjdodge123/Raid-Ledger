import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';

/**
 * Game Activity Sessions — tracks individual play sessions detected
 * via Discord presence updates (ROK-442).
 *
 * A session opens when a user starts playing a game and closes when they stop.
 * Unmatched games are stored with null game_id for later manual mapping.
 */
export const gameActivitySessions = pgTable(
  'game_activity_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id').references(() => games.id, {
      onDelete: 'set null',
    }),
    discordActivityName: text('discord_activity_name').notNull(),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
    /** Computed on session close: difference between ended_at and started_at */
    durationSeconds: integer('duration_seconds'),
  },
  (table) => ({
    userGameStartedIdx: index(
      'game_activity_sessions_user_game_started_idx',
    ).on(table.userId, table.gameId, table.startedAt),
    gameStartedIdx: index('game_activity_sessions_game_started_idx').on(
      table.gameId,
      table.startedAt,
    ),
  }),
);
