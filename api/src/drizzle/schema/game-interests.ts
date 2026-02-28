import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';

/**
 * Game interests table — tracks which games users want to play.
 * Powers the "Your Community Wants to Play" discovery row.
 * ROK-229: Want-to-play system.
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
    /** Source of the interest. Valid values: 'manual', 'discord', 'steam' (enforced by DB CHECK constraint) */
    source: text('source').default('manual').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique('uq_user_game_interest').on(table.userId, table.gameId)],
);
