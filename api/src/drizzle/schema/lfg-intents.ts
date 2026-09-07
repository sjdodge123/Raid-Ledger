import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { games } from './games';
import { events } from './events';
import { communityLineupMatches } from './community-lineup-matches';

/**
 * LFG intents — "I want to play this game" (ROK-1451).
 *
 * The LFG/LFM distinction is DERIVED from the number of live rows per game
 * (1 → lfg, >= 2 → lfm, 0 → none), so there is deliberately no state column
 * and no join mechanic. `expires_at` is written by app code from the single
 * `LFG_EXPIRY_DAYS` constant rather than a SQL default, so the horizon lives
 * in exactly one place.
 */
export const lfgIntents = pgTable(
  'lfg_intents',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    /** One of `active` | `converted` | `expired` | `cleared` (DB CHECK). */
    status: text('status').default('active').notNull(),
    /** ROK-274 relay seam — column ships now, only `local` is implemented. */
    visibility: text('visibility').default('local').notNull(),
    /**
     * `week` (the ROK-1451 14-day intent) or `now` (ROK-1479's on-demand one).
     *
     * STORED rather than derived from `expires_at`: `refreshGroupExpiry` has to
     * decide PER ROW whether somebody else's +1 lengthens it, and both
     * candidate derivations misclassify a row at exactly that moment (a bumped
     * week-old row reads as `week`; a nearly-lapsed weekly row reads as `now`).
     * The `'week'` default is the pre-1479 semantics, so no backfill is needed.
     */
    urgency: text('urgency').default('week').notNull(),
    /**
     * How many minutes a `now` intent lives — NULL on every `week` row.
     *
     * Stored because of the A3 ruling: a +1 refreshes a now-intent by its OWN
     * horizon (30 or 60 minutes from the +1), never to 14 days, so the refresh
     * distance has to survive on the row.
     */
    ttlMinutes: integer('ttl_minutes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** Set in app code to `now() + LFG_EXPIRY_DAYS`. */
    expiresAt: timestamp('expires_at').notNull(),
    /** Provenance — the scheduling poll this group converted into. */
    convertedToPollId: integer('converted_to_poll_id').references(
      () => communityLineupMatches.id,
      { onDelete: 'set null' },
    ),
    /** Provenance — the event this group converted into. */
    convertedToEventId: integer('converted_to_event_id').references(
      () => events.id,
      { onDelete: 'set null' },
    ),
  },
  (table) => [
    check(
      'lfg_intents_status_check',
      sql`${table.status} IN ('active', 'converted', 'expired', 'cleared')`,
    ),
    check(
      'lfg_intents_visibility_check',
      sql`${table.visibility} IN ('local', 'cross-community')`,
    ),
    check(
      'lfg_intents_urgency_check',
      sql`${table.urgency} IN ('week', 'now')`,
    ),
    /**
     * Deliberately permissive about the pairing: it constrains the VALUE, not
     * the combination, so the column can be added without rewriting any
     * existing row. The app is what keeps `ttl_minutes` NULL on week rows.
     */
    check(
      'lfg_intents_ttl_minutes_check',
      sql`${table.ttlMinutes} IS NULL OR ${table.ttlMinutes} IN (30, 60)`,
    ),
    /**
     * The concurrency guard: at most one LIVE intent per (user, game).
     * Writes take `ON CONFLICT DO NOTHING` against this index and re-select
     * the winner — a caught unique violation would poison the transaction
     * (see memory `reference_postgres_savepoint_does_not_contain_violations`).
     */
    uniqueIndex('uq_lfg_intents_user_game_active')
      .on(table.userId, table.gameId)
      .where(sql`${table.status} = 'active'`),
    /** Group counts. */
    index('idx_lfg_intents_game_active')
      .on(table.gameId)
      .where(sql`${table.status} = 'active'`),
    /** Hourly expiry sweep. */
    index('idx_lfg_intents_expires_at')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'active'`),
  ],
);
