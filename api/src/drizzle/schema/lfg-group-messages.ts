import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  index,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { games } from './games';

/**
 * The Discord message that represents one LFM group (ROK-1454 D4).
 *
 * `discord_event_messages` cannot be reused: its `event_id` is NOT NULL and
 * FK'd to `events`, and an LFM group has no event. The row exists because the
 * message must survive a bot restart to be editable at all — the in-memory Map
 * alternative loses every open group on every deploy.
 *
 * `last_member_count` is the only reason the EXPIRED render can name a number:
 * once the sweep flips every intent to `expired`, `lfg_intents` has no group id
 * to distinguish this group's corpses from the same game's group three months
 * ago, so the count is stored on every successful post/edit instead (D6).
 *
 * No `thread_id` / `post_kind` — ROK-1471 adds those in its own migration.
 */
export const lfgGroupMessages = pgTable(
  'lfg_group_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: integer('game_id').notNull(),
    guildId: varchar('guild_id', { length: 255 }).notNull(),
    channelId: varchar('channel_id', { length: 255 }).notNull(),
    messageId: varchar('message_id', { length: 255 }).notNull(),
    /** One of `open` | `converted` | `expired` | `closed` (DB CHECK). */
    state: text('state').default('open').notNull(),
    /** Head-count at the last successful render — the EXPIRED roster (D6). */
    lastMemberCount: integer('last_member_count').default(0).notNull(),
    postedAt: timestamp('posted_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    /** Set when the group reached a terminal state. */
    closedAt: timestamp('closed_at'),
  },
  (table) => [
    // Explicit FK name: drizzle's default for a composite of this table's name
    // runs long, and Postgres truncates identifiers past 63 chars SILENTLY —
    // the name drizzle believes in then diverges from the database's (ROK-1387,
    // re-caught by ROK-1446's gate at 67 chars).
    foreignKey({
      columns: [table.gameId],
      foreignColumns: [games.id],
      name: 'lfg_group_messages_game_id_fk',
    }).onDelete('cascade'),
    check(
      'lfg_group_messages_state_check',
      sql`${table.state} IN ('open', 'converted', 'expired', 'closed')`,
    ),
    /**
     * "One live message per group", enforced by Postgres rather than by a Map.
     *
     * The predicate is what makes it survivable: a NON-partial unique on
     * `game_id` would let a game post exactly one LFM message ever, wedging
     * every later group behind a row nobody can clear.
     */
    uniqueIndex('uq_lfg_group_messages_game_open')
      .on(table.gameId)
      .where(sql`${table.state} = 'open'`),
    /** Reverse lookup from a Discord message back to its group. */
    index('idx_lfg_group_messages_message').on(
      table.guildId,
      table.channelId,
      table.messageId,
    ),
  ],
);
