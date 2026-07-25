/**
 * ROK-1419 (B2): per-loser audit of the non-series channel_bindings dedupe.
 *
 * One row per DELETED binding (a "loser"), written by migration 0161's
 * hand-inserted dedupe DML and scoped by a literal `run_id` baked into that
 * file. It is the operator's UNDO record — NEVER TRUNCATE it (contrast
 * games_dedup_audit, which is TRUNCATE+INSERT each run).
 *
 * Per-loser (not per-group) shape: `UNIQUE(loser_binding_id, reason)` +
 * `ON CONFLICT DO NOTHING` makes the audit INSERT idempotent, and it lets an
 * event repointed away from a loser be matched back by
 * `moved_events x loser_binding_id` with no pre-UPDATE-value gymnastics
 * (a repointed event had `old_channel_binding_id = loser_binding_id` by
 * construction). Restore is valid only against `schema_version = '0161'`.
 */
import {
  pgTable,
  serial,
  uuid,
  varchar,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const channelBindingsDedupAudit = pgTable(
  'channel_bindings_dedup_audit',
  {
    id: serial('id').primaryKey(),
    /** Literal UUID baked into 0161 — every DML statement is run-scoped by it. */
    runId: uuid('run_id').notNull(),
    /** Migration tag whose row shape `loser_row` was captured against ('0161'). */
    schemaVersion: varchar('schema_version', { length: 16 }).notNull(),
    /** Dedupe reason discriminator ('nonseries-dedupe'). Half of the idem key. */
    reason: varchar('reason', { length: 32 }).notNull(),
    // ── group key (game_id nullable, NO FK — losers may point at deleted games) ──
    guildId: varchar('guild_id', { length: 255 }).notNull(),
    channelId: varchar('channel_id', { length: 255 }).notNull(),
    bindingPurpose: varchar('binding_purpose', { length: 50 }).notNull(),
    gameId: integer('game_id'),
    /** The surviving binding this loser's live events were repointed to. */
    survivorId: uuid('survivor_id').notNull(),
    /** The deleted binding this row records. */
    loserBindingId: uuid('loser_binding_id').notNull(),
    /** Full `to_jsonb(cb)` of the deleted row — restores it verbatim. */
    loserRow: jsonb('loser_row').$type<Record<string, unknown>>().notNull(),
    /** `[{event_id}]` repointed FROM this loser to the survivor. */
    movedEvents: jsonb('moved_events')
      .$type<Array<{ event_id: number }>>()
      .notNull()
      .default([]),
    /** LIVE ad-hoc events repointed to the survivor. */
    eventsRepointed: integer('events_repointed').notNull().default(0),
    /** Historical events that took the FK ON DELETE SET NULL (AC4 count). */
    eventsNulled: integer('events_nulled').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Idempotency key: one audit row per (deleted binding, reason).
    uniqueIndex('channel_bindings_dedup_audit_loser_reason_unique').on(
      table.loserBindingId,
      table.reason,
    ),
  ],
);
