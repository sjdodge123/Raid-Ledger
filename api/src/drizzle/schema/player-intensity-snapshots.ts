import {
  pgTable,
  serial,
  integer,
  decimal,
  date,
  timestamp,
  jsonb,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';

/**
 * Player Intensity Snapshots — weekly rollup of play hours per user (ROK-948).
 * Populated by a weekly cron from game_activity_rollups + voice sessions.
 */
export const playerIntensitySnapshots = pgTable(
  'player_intensity_snapshots',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    weekStart: date('week_start').notNull(),
    totalHours: decimal('total_hours', { precision: 10, scale: 2 }).notNull(),
    gameBreakdown: jsonb('game_breakdown')
      .$type<Array<{ gameId: number; hours: number; source: string }>>()
      .notNull(),
    uniqueGames: integer('unique_games').notNull(),
    longestSessionHours: decimal('longest_session_hours', {
      precision: 10,
      scale: 2,
    }).notNull(),
    longestSessionGameId: integer('longest_session_game_id').references(
      () => games.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userWeekUnique: unique('uq_player_intensity_user_week').on(
      table.userId,
      table.weekStart,
    ),
    weekStartIdx: index('player_intensity_snapshots_week_start_idx').on(
      table.weekStart,
    ),
  }),
);
