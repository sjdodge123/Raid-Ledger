import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { channelBindings } from './channel-bindings';

/**
 * ROK-1446 — the ONE live presence message per bound general-lobby voice
 * channel (D7).
 *
 * This table is the truth for "does a message already exist for this room";
 * the service's in-memory map is only a cache. `ensureMessage` consults the
 * open row before it ever posts, and `recover()` re-adopts every open row on
 * `DISCORD_BOT_EVENTS.CONNECTED` — that is what makes the embed survive a bot
 * restart (same failure class as ROK-970's orphaned ad-hoc events).
 *
 * Lifecycle: a row is opened on the first flush with >= 1 human in the room
 * and closed (never deleted) once the room has been empty past the binding's
 * grace period, once the message has gone missing (Discord 10008), or once the
 * binding is gone. Closed rows are history — the next occupancy opens a NEW
 * row and posts a NEW message.
 *
 * `binding_id` is nullable + ON DELETE SET NULL on purpose: deleting the
 * binding must not delete the ledger row, it must leave a row the reaper can
 * see, recap and close (D7).
 */
export const discordChannelPresenceMessages = pgTable(
  'discord_channel_presence_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: varchar('guild_id', { length: 255 }).notNull(),
    /** The bound VOICE channel this message describes. */
    voiceChannelId: varchar('voice_channel_id', { length: 255 }).notNull(),
    /** Null once the binding is deleted — the row still needs recap + close. */
    bindingId: uuid('binding_id').references(() => channelBindings.id, {
      onDelete: 'set null',
    }),
    /** The TEXT channel the message was posted to (resolver-chosen at open). */
    textChannelId: varchar('text_channel_id', { length: 255 }).notNull(),
    messageId: varchar('message_id', { length: 255 }).notNull(),
    /** `open` | `closed` — see the partial unique index below. */
    status: varchar('status', { length: 10 }).notNull().default('open'),
    /**
     * D5 dirty-check: a stable hash of the last SUCCESSFULLY rendered embed
     * payload. A flush whose freshly rendered payload hashes the same skips
     * the edit entirely (AC5's second clause). Written only after the edit
     * resolves, so a failed edit retries on the next tick. Nullable — a row
     * that has not completed an edit yet has no hash to compare against.
     */
    payloadHash: varchar('payload_hash', { length: 64 }),
    openedAt: timestamp('opened_at').defaultNow().notNull(),
    /** First flush that saw 0 humans; cleared on rejoin inside the grace. */
    emptySince: timestamp('empty_since'),
    closedAt: timestamp('closed_at'),
    /** `empty` | `missing` | `unbound` | `stale` — why the row was closed. */
    closeReason: varchar('close_reason', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'discord_channel_presence_messages_status_check',
      sql`${table.status} IN ('open', 'closed')`,
    ),
    /**
     * The concurrency guard: at most ONE open message per room (AC1). Partial
     * so the closed history rows for the same room never collide. Follows the
     * `channel_bindings_nonseries_*` / `uq_lfg_intents_user_game_active`
     * idiom. Writers must pre-check rather than catch a violation — a caught
     * unique violation poisons the whole transaction (see memory
     * `reference_postgres_savepoint_does_not_contain_violations`).
     */
    uniqueIndex('uq_channel_presence_open_per_channel')
      .on(table.guildId, table.voiceChannelId)
      .where(sql`${table.status} = 'open'`),
    /** `onEventEnded(bindingId)` and the binding-delete reap path. */
    index('idx_channel_presence_binding').on(table.bindingId),
  ],
);
