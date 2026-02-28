import { pgTable, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';

/**
 * Game Interest Suppressions — prevents auto-heart from re-triggering
 * for a game the user explicitly un-hearted (ROK-444).
 *
 * When a user removes a discord-sourced auto-heart, a row is inserted here
 * so the daily cron skips that (user, game) pair in future runs.
 */
export const gameInterestSuppressions = pgTable(
  'game_interest_suppressions',
  {
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    suppressedAt: timestamp('suppressed_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_user_game_suppression').on(table.userId, table.gameId),
  ],
);
