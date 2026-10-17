/**
 * ROK-1270: persisted snapshot of the games-row dedup audit.
 *
 * One row per dup group from a `runAudit()` pass. `snapshot_at` is shared
 * across all rows of a single POST `/admin/games/dedup-audit/run` call so
 * downstream tooling can filter the most recent run. TRUNCATE+INSERT each
 * call — historical snapshots are NOT retained (Phase 2 may revisit).
 */
import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { games } from './games';
import type { BlastRadiusCounts } from '../../admin/games-dedup-audit.helpers';
import type { UniqueConflictCounts } from '../../admin/games-dedup-unique-conflicts.helpers';

export const gamesDedupAudit = pgTable(
  'games_dedup_audit',
  {
    id: serial('id').primaryKey(),
    matchType: text('match_type').notNull(),
    matchKey: text('match_key').notNull(),
    canonicalGameId: integer('canonical_game_id')
      .references(() => games.id)
      .notNull(),
    dupGameIds: integer('dup_game_ids').array().notNull(),
    groupSize: integer('group_size').notNull(),
    downstreamCounts: jsonb('downstream_counts')
      .$type<BlastRadiusCounts>()
      .notNull(),
    uniqueConflicts: jsonb('unique_conflicts')
      .$type<UniqueConflictCounts>()
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    snapshotAt: timestamp('snapshot_at').notNull(),
  },
  (table) => [
    index('games_dedup_audit_snapshot_at_match_type_idx').on(
      table.snapshotAt,
      table.matchType,
    ),
  ],
);
