import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  BindingLifecycleState,
  ChannelBindingConfig,
} from '@raid-ledger/contract';
import { games } from './games';

/** An overwrite bit's tri-state before archive changed it. */
export type OverwritePriorState = 'allow' | 'deny' | 'inherit';

/** The bits an archive locks (thread bits: Codex r4b — read-only means threads too). */
type ArchivedOverwriteFlag =
  | 'SendMessages'
  | 'SendMessagesInThreads'
  | 'CreatePublicThreads'
  | 'CreatePrivateThreads'
  | 'ViewChannel';

/**
 * One overwrite bit an archive changed, with the state to restore.
 * `everyone` = the `@everyone` role overwrite; `bot` = the bot's member
 * overwrite; `role` / `member` (Codex r3) = any other overwrite whose explicit
 * Allow the archive turned into a Deny, keyed by its snowflake `id`.
 */
export type ArchivedOverwriteChange =
  | {
      target: 'everyone' | 'bot';
      flag: ArchivedOverwriteFlag;
      prior: OverwritePriorState;
    }
  | {
      target: 'role' | 'member';
      id: string;
      flag: ArchivedOverwriteFlag;
      prior: OverwritePriorState;
    };

/**
 * ROK-1428 D6, v1 (pre Codex r2): booleans for the bits an archive ADDED;
 * unarchive resets each to inherit. Still read for rows written before v2.
 */
export interface ArchivedOverwritesV1 {
  /** `@everyone` SendMessages deny. */
  everyoneSend: boolean;
  /** `@everyone` ViewChannel deny (hideOnArchive). */
  everyoneView: boolean;
  /** The bot's member ViewChannel allow (granted with the hide). */
  botView: boolean;
}

/** v2: every bit the archive changed with its prior state — unarchive restores exactly these. */
export interface ArchivedOverwritesV2 {
  changes: ArchivedOverwriteChange[];
}

/** The `archived_overwrites` record (v2 written; v1 still read). */
export type ArchivedOverwrites = ArchivedOverwritesV1 | ArchivedOverwritesV2;

/** Columns the ROK-1429 lifecycle constraints reference. */
interface LifecycleColumns {
  guildId: AnyPgColumn;
  gameId: AnyPgColumn;
  recurrenceGroupId: AnyPgColumn;
  lifecycleState: AnyPgColumn;
  autoManaged: AnyPgColumn;
}

/**
 * ROK-1429: lifecycle state CHECK, the rule that only an auto-managed row can
 * be archived, and the reconciler's partial lookup index.
 */
function lifecycleConstraints(table: LifecycleColumns) {
  return [
    check(
      'channel_bindings_lifecycle_state_check',
      sql`${table.lifecycleState} IN ('active', 'archived')`,
    ),
    check(
      'channel_bindings_archived_auto_check',
      sql`${table.lifecycleState} = 'active' OR ${table.autoManaged}`,
    ),
    index('idx_channel_bindings_lifecycle')
      .on(table.guildId, table.gameId, table.lifecycleState)
      .where(sql`${table.autoManaged} AND ${table.recurrenceGroupId} IS NULL`),
  ];
}

/**
 * Channel Bindings - Maps Discord channels to games/behaviors.
 * Used for smart routing of event announcements and voice monitoring.
 * ROK-348: Channel Binding System.
 * ROK-435: Added recurrence_group_id for series-specific channel bindings.
 *
 * No community_id column - the app is single-tenant.
 * guild_id serves as the scope identifier.
 */
export const channelBindings = pgTable(
  'channel_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: varchar('guild_id', { length: 255 }).notNull(),
    channelId: varchar('channel_id', { length: 255 }).notNull(),
    channelType: varchar('channel_type', { length: 50 }).notNull(), // 'text', 'voice', 'forum' (ROK-1471)
    bindingPurpose: varchar('binding_purpose', { length: 50 }).notNull(), // 'game-announcements', 'game-voice-monitor', 'general-lobby', 'lfg-board'
    gameId: integer('game_id').references(() => games.id, {
      onDelete: 'set null',
    }),
    /** ROK-435: Optional recurrence group ID to bind a specific event series to this channel. */
    recurrenceGroupId: uuid('recurrence_group_id'),
    config: jsonb('config').default({}).$type<ChannelBindingConfig>(),
    /** ROK-1429: 'active' | 'archived' — only an auto-managed binding archives. */
    lifecycleState: varchar('lifecycle_state', { length: 10 })
      .$type<BindingLifecycleState>()
      .default('active')
      .notNull(),
    /** ROK-1429: created by the lifecycle reconciler (manual bindings are never touched). */
    autoManaged: boolean('auto_managed').default(false).notNull(),
    /** ROK-1429: an admin pin keeps the channel active regardless of activity. */
    pinned: boolean('pinned').default(false).notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** ROK-1429 (D6): the category the channel sat in before archive, for unarchive. */
    restoreParentId: varchar('restore_parent_id', { length: 32 }),
    /** ROK-1428 D6: the bits archive added; null when not archived. */
    archivedOverwrites: jsonb(
      'archived_overwrites',
    ).$type<ArchivedOverwrites>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('channel_bindings_guild_channel_series_unique').on(
      table.guildId,
      table.channelId,
      table.recurrenceGroupId,
    ),
    index('idx_channel_bindings_guild').on(table.guildId),
    index('idx_channel_bindings_game').on(table.gameId),
    index('idx_channel_bindings_recurrence_group').on(table.recurrenceGroupId),
    // ROK-1419: restore duplicate protection for NON-series bindings that
    // migration 0067 dropped (its 3-column key's nullable recurrence_group_id
    // made NULL != NULL erase all protection). Two ADDITIVE partial unique
    // indexes keyed on binding_purpose. The 0067 index is untouched.
    //
    // PERMITTED by construction (never over-rejected):
    //   - two game-voice-monitor rows for DIFFERENT games (ROK-842) — game_id
    //     is part of the game-partial key.
    //   - monitor(game) + general-lobby(NULL) on one channel (prod #Gamer
    //     Night) — they live in DIFFERENT partial indexes (game-not-null vs
    //     null-game).
    //   - any series row (recurrence_group_id IS NOT NULL) — excluded from
    //     both predicates; the 0067 index governs series uniqueness.
    // REJECTED: a second row sharing (guild, channel, purpose, game) among
    //   non-series rows, and two null-game rows of the same purpose.
    uniqueIndex('channel_bindings_nonseries_game_unique')
      .on(table.guildId, table.channelId, table.bindingPurpose, table.gameId)
      .where(
        sql`${table.recurrenceGroupId} IS NULL AND ${table.gameId} IS NOT NULL`,
      ),
    uniqueIndex('channel_bindings_nonseries_nullgame_unique')
      .on(table.guildId, table.channelId, table.bindingPurpose)
      .where(
        sql`${table.recurrenceGroupId} IS NULL AND ${table.gameId} IS NULL`,
      ),
    ...lifecycleConstraints(table),
  ],
);
