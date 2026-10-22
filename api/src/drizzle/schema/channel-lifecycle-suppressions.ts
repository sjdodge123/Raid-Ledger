import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { games } from './games';

/** Why a game's managed channel stopped being managed (ROK-1428 D9). */
export type ChannelLifecycleSuppressionReason = 'deleted' | 'unbound';

/**
 * ROK-1429 (ROK-1428 D9): games whose lifecycle-managed channel was deleted or
 * unbound by hand. The reconciler never re-creates a channel for a suppressed
 * game; the admin "Recreate" action deletes the row. Keeps tombstones out of
 * channel_bindings so its readers stay untouched.
 */
export const channelLifecycleSuppressions = pgTable(
  'channel_lifecycle_suppressions',
  {
    id: serial('id').primaryKey(),
    guildId: varchar('guild_id', { length: 255 }).notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    reason: varchar('reason', { length: 10 })
      .$type<ChannelLifecycleSuppressionReason>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('channel_lifecycle_suppressions_guild_game_unique').on(
      table.guildId,
      table.gameId,
    ),
    index('idx_channel_lifecycle_suppressions_game').on(table.gameId),
    check(
      'channel_lifecycle_suppressions_reason_check',
      sql`${table.reason} IN ('deleted', 'unbound')`,
    ),
  ],
);

export type ChannelLifecycleSuppressionSelect =
  typeof channelLifecycleSuppressions.$inferSelect;
export type ChannelLifecycleSuppressionInsert =
  typeof channelLifecycleSuppressions.$inferInsert;
