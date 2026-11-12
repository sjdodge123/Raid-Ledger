import {
  pgTable,
  serial,
  integer,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { GgActivityTier, GgSnapshot } from '@raid-ledger/contract';
import { users } from './users';

/**
 * ROK-2187 — GG <year>: one frozen snapshot per user per year.
 *
 * `payload` is written whole once by the delivery cron and never recomputed
 * by a read; it is versioned in the contract (`parseGgSnapshot` accepts every
 * stored `schemaVersion`, so past years stay readable — R5). `schema_version`
 * mirrors `payload.schemaVersion` for cheap filtering.
 *
 * Sharing is opt-in per year (Q5): `share_slug` + `shared_at` are set
 * together and nulled together (CHECK); re-sharing mints a new slug.
 *
 * DM idempotency is row-level: the DM wave claims rows with
 * `UPDATE … SET dm_claimed_at = now() WHERE dm_claimed_at IS NULL … SKIP
 * LOCKED`, stamps `dm_sent_at` on success and releases the claim on failure.
 * The announcement is deduped by `NotificationDedupService`, not here.
 */
export const ggSnapshots = pgTable(
  'gg_snapshots',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    payload: jsonb('payload').$type<GgSnapshot>().notNull(),
    activityTier: text('activity_tier').$type<GgActivityTier>().notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Public `/w/:slug` key; NULL = not shared. */
    shareSlug: text('share_slug').unique(),
    sharedAt: timestamp('shared_at', { withTimezone: true }),
    dmClaimedAt: timestamp('dm_claimed_at', { withTimezone: true }),
    dmSentAt: timestamp('dm_sent_at', { withTimezone: true }),
  },
  (t) => [
    // Leads with user_id → also backs the users FK (fk-index-coverage).
    uniqueIndex('gg_snapshots_user_year_uq').on(t.userId, t.year),
    // DM wave: unclaimed rows of the year being delivered.
    index('gg_snapshots_dm_pending_idx')
      .on(t.year)
      .where(sql`${t.dmClaimedAt} IS NULL`),
    check('gg_snapshots_tier_chk', sql`${t.activityTier} IN ('short', 'full')`),
    check(
      'gg_snapshots_share_pair_chk',
      sql`(${t.shareSlug} IS NULL) = (${t.sharedAt} IS NULL)`,
    ),
  ],
);

export type GgSnapshotRow = typeof ggSnapshots.$inferSelect;
export type NewGgSnapshotRow = typeof ggSnapshots.$inferInsert;
