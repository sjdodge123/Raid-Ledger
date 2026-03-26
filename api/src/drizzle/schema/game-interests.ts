import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';

/**
 * Game interests table — tracks which games users want to play.
 * Powers the "Your Community Wants to Play" discovery row.
 * ROK-229: Want-to-play system.
 * ROK-417: Widened unique constraint to (user_id, game_id, source) to allow
 *          multiple sources per game (manual heart, steam_library, etc.).
 */
export const gameInterests = pgTable(
  'game_interests',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    /** Source of the interest. Valid values: 'manual', 'discord', 'steam_library', 'steam_wishlist' (enforced by DB CHECK constraint) */
    source: text('source').default('manual').notNull(),
    /** ROK-417: Total minutes played (Steam lifetime) */
    playtimeForever: integer('playtime_forever'),
    /** ROK-417: Minutes played in last 2 weeks (Steam) */
    playtime2weeks: integer('playtime_2weeks'),
    /** ROK-417: When playtime was last synced from Steam */
    lastSyncedAt: timestamp('last_synced_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_user_game_interest_source').on(
      table.userId,
      table.gameId,
      table.source,
    ),
    /** L-4: Standalone index for want-to-play count queries filtering by game */
    index('idx_game_interests_game_id').on(table.gameId),
  ],
);
