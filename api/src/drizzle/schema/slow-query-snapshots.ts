import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  bigint,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Slow query snapshots (ROK-1156).
 *
 * Daily 06:00 UTC cron snapshots `pg_stat_statements` into these tables.
 * `getLatestDigest` diffs the latest snapshot against the most recent
 * `source='cron'` snapshot to surface per-window slow queries on the admin
 * Logs page.
 *
 * `queryid` is sourced externally from `pg_stat_statements.queryid` (bigint),
 * not generated locally — that is why it is not declared as `serial`.
 */
export const slowQuerySnapshots = pgTable('slow_query_snapshots', {
  id: serial('id').primaryKey(),
  capturedAt: timestamp('captured_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  source: text('source').notNull(),
});

export const slowQuerySnapshotEntries = pgTable(
  'slow_query_snapshot_entries',
  {
    id: serial('id').primaryKey(),
    snapshotId: integer('snapshot_id')
      .references(() => slowQuerySnapshots.id, { onDelete: 'cascade' })
      .notNull(),
    queryid: bigint('queryid', { mode: 'bigint' }).notNull(),
    queryText: text('query_text').notNull(),
    calls: bigint('calls', { mode: 'bigint' }).notNull(),
    meanExecTimeMs: doublePrecision('mean_exec_time_ms').notNull(),
    totalExecTimeMs: doublePrecision('total_exec_time_ms').notNull(),
  },
  (table) => ({
    snapshotQueryIdx: index('idx_slow_query_entries_snapshot_queryid').on(
      table.snapshotId,
      table.queryid,
    ),
  }),
);
