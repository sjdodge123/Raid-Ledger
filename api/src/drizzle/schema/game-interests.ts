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
    /** Source of the interest. Valid values: 'manual', 'discord', 'steam_library', 'steam_wishlist', 'poll' (enforced by DB CHECK constraint) */
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
    /**
     * ROK-1109: covering index for the per-game ownership aggregations.
     *
     * Every hot reader of this table (`loadCommunityOwnership`,
     * `loadCandidateContext`, `loadSuggestionMeta`, the Common Ground
     * projection) joins on `game_id` and then counts rows FILTERed by
     * `source` — three of them also by `user_id`. With only the narrow
     * `(game_id)` index the planner preferred a full seq scan of
     * `game_interests` over ~120 bitmap-heap lookups, because the heap is
     * not clustered by `game_id`. Carrying `source` and `user_id` in the
     * index turns those joins into index-only scans and the seq scan
     * disappears. Supersedes the old L-4 `idx_game_interests_game_id`,
     * whose leading column this index still satisfies.
     */
    index('idx_game_interests_game_id_source_user').on(
      table.gameId,
      table.source,
      table.userId,
    ),
  ],
);
