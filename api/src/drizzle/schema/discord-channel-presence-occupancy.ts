import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { discordChannelPresenceMessages } from './discord-channel-presence-messages';
import { games } from './games';

/**
 * ROK-1499 — who was in the voice room while a presence message was open.
 *
 * The presence service only ever knows the room's CURRENT members: it
 * re-derives the room from Discord on every flush (D4) and keeps nothing. That
 * is fine for the live embed and useless for the recap, which has to answer
 * "who was in here and for how long" AFTER everyone has left and there is
 * nothing left to read. This table is the only record of the span.
 *
 * One row per continuous STAY, not per human — a re-join opens a second row,
 * and `summariseRoom` merges them back into one member entry. Pre-merging here
 * would lose the gap and over-count the stay.
 *
 * `left_at IS NULL` means "still in the room as far as the last flush could
 * tell". The reconcile pass stamps it when a member disappears from the room,
 * and the empty-room ladder closes every straggler at `empty_since` — so a bot
 * that dies mid-session leaves open rows that the next close stamps, rather
 * than rows that claim an infinite stay.
 *
 * Rows hang off the presence row with ON DELETE CASCADE: the occupancy of a
 * message that no longer exists is not history anybody can read.
 */
export const discordChannelPresenceOccupancy = pgTable(
  'discord_channel_presence_occupancy',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The presence message whose span this stay belongs to. */
    presenceMessageId: uuid('presence_message_id').notNull(),
    /** Discord snowflake — humans only; bots never reach this table (AC3). */
    discordUserId: varchar('discord_user_id', { length: 255 }).notNull(),
    /**
     * Display name as the room reported it when the stay opened. Denormalised
     * on purpose: the recap renders bold plain text and must still name
     * someone who has since left the guild.
     */
    displayName: varchar('display_name', { length: 255 }).notNull(),
    /**
     * What presence detection said this member was playing, as of the last
     * flush that saw them (ROK-1499 P2-2).
     *
     * `game_activity_sessions` only exists for LINKED Raid Ledger users, and
     * not at all for a `/playing` manual override — so an unlinked occupant
     * showed a game on the live embed and then vanished from the recap. The
     * room already knows their game at every flush; this is the only place it
     * was being thrown away. `null` = presence produced no game.
     */
    gameId: integer('game_id'),
    /**
     * The group's rendered game name, kept beside `game_id` as the fallback
     * for a games row that is later deleted. Never a placeholder: a member
     * with no detected game stores NULL in both columns rather than
     * "Untitled Gaming Session" or "Just Chatting", which are not games and
     * must not be summed as play time.
     */
    activityName: varchar('activity_name', { length: 255 }),
    /** The flush that first saw this member in the room. */
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    /** `null` while the member is still present; clamps to `empty_since`. */
    leftAt: timestamp('left_at'),
  },
  (table) => [
    /** Every read is "the occupancy of this message". */
    index('idx_channel_presence_occupancy_msg').on(table.presenceMessageId),
    /**
     * The reconcile pass reads ONLY the open rows of one message, once per
     * five-second tick per bound channel. Partial so the index stays the size
     * of the live room rather than the size of all history.
     */
    index('idx_channel_presence_occupancy_open')
      .on(table.presenceMessageId)
      .where(sql`${table.leftAt} is null`),
    foreignKey({
      columns: [table.gameId],
      foreignColumns: [games.id],
      name: 'channel_presence_occupancy_game_id_fk',
    }).onDelete('set null'),
    // ROK-1387: drizzle's default name for this FK is 89 chars and Postgres
    // truncates at 63, so the name drizzle believes in and the one the
    // database holds would diverge. Same fix as `channel_presence_binding_id_fk`.
    foreignKey({
      columns: [table.presenceMessageId],
      foreignColumns: [discordChannelPresenceMessages.id],
      name: 'channel_presence_occupancy_message_id_fk',
    }).onDelete('cascade'),
  ],
);
