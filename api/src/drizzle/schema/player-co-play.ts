import {
  pgTable,
  integer,
  timestamp,
  jsonb,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/**
 * Player Co-Play Graph — pairwise record of users who play together
 * (ROK-948). Populated by a daily cron from voice session overlaps and
 * shared event signups. user_id_a is always the lower user id; a CHECK
 * constraint enforces canonical ordering.
 */
export const playerCoPlay = pgTable(
  'player_co_play',
  {
    userIdA: integer('user_id_a')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    userIdB: integer('user_id_b')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    sessionCount: integer('session_count').notNull(),
    totalMinutes: integer('total_minutes').notNull(),
    lastPlayedAt: timestamp('last_played_at').notNull(),
    gamesPlayed: jsonb('games_played').$type<number[]>().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userIdA, table.userIdB] }),
    canonicalOrder: check(
      'chk_player_co_play_canonical_order',
      sql`${table.userIdA} < ${table.userIdB}`,
    ),
  }),
);
