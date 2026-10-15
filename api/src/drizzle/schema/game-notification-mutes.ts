import {
  pgTable,
  integer,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';

/**
 * Game Notification Mutes (ROK-1797) — a user's per-game "bell off" list.
 *
 * A row silences every per-game broadcast DM (game alert, LFG invite,
 * recruitment reminder, standalone scheduling poll) for that (user, game).
 * It is independent of the heart: un-heart and the Steam sync never touch it,
 * which is why it is its own table and not a column on `game_interests`.
 * Readers AND `notGameMutedSql` (notifications/game-notification-mute.helpers).
 */
export const gameNotificationMutes = pgTable(
  'game_notification_mutes',
  {
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.gameId] }),
    index('idx_game_notification_mutes_game_id').on(table.gameId),
  ],
);
