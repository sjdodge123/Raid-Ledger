import {
  pgTable,
  integer,
  varchar,
  date,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';

/**
 * Game Activity Rollups — aggregated playtime per user/game/period (ROK-442).
 *
 * Populated by a daily cron job that sums closed session durations.
 * Uses upsert (ON CONFLICT UPDATE) so re-runs are idempotent.
 */
export const gameActivityRollups = pgTable(
  'game_activity_rollups',
  {
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    period: varchar('period', { length: 10 }).notNull(), // 'day', 'week', 'month'
    periodStart: date('period_start').notNull(),
    totalSeconds: integer('total_seconds').notNull().default(0),
  },
  (table) => ({
    userGamePeriodUnique: unique(
      'game_activity_rollups_user_game_period_unique',
    ).on(table.userId, table.gameId, table.period, table.periodStart),
    gamePeriodStartIdx: index('game_activity_rollups_game_period_start_idx').on(
      table.gameId,
      table.period,
      table.periodStart,
    ),
  }),
);
