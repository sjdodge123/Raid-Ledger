/**
 * Voter-cohort lineup memory (ROK-1309).
 *
 * One row per (cohort, game, source lineup, outcome). A "cohort" is the
 * *engaged participant set* of a lineup —
 * `union(community_lineup_entries.nominated_by, community_lineup_votes.user_id)`
 * — NOT the invitee list and NOT the linked event's signup roster. Visibility
 * agnostic: public and private lineups both write here and both read back.
 *
 * ## Canonical `participant_hash` encoding (STRICT — S1 decides it, S2/S3 obey)
 *
 * `participant_hash = sha1( participant_ids sorted NUMERICALLY ascending,
 *                           joined with a single ',', no trailing separator )`
 *
 * e.g. `{10, 2, 7}` -> `"2,7,10"` -> sha1 -> hex, lowercase.
 *
 * Sort numerically, never as text: `[2, 10]` sorts to `2,10` numerically but
 * `10,2` as text. The TypeScript writer (S2) and the SQL backfill (S3) must
 * produce byte-identical input or backfilled cohorts never match live-written
 * ones and the feature silently "has no data". S3's test asserts the two
 * hashes are equal for the same cohort.
 *
 * SQL side:
 *   encode(digest(array_to_string(ARRAY(SELECT unnest(ids) ORDER BY 1), ','),
 *                 'sha1'), 'hex')
 * TS side:
 *   createHash('sha1').update([...ids].sort((a, b) => a - b).join(',')).digest('hex')
 *
 * ## Idempotency
 *
 * `uq_cl_cohort_memory_row` is the natural key. Every writer uses
 * `ON CONFLICT DO NOTHING` against it — never catch-and-retry, because under
 * postgres.js a failed statement poisons the whole transaction, savepoints
 * included (ROK-1437). Replaying a transition or re-running the backfill is
 * therefore a no-op.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  smallint,
  timestamp,
  index,
  unique,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { communityLineups } from './community-lineups';
import { games } from './games';

export type CohortMemoryResolution =
  'decided' | 'match' | 'veto_won' | 'veto_lost';

export const communityLineupCohortMemory = pgTable(
  'community_lineup_cohort_memory',
  {
    id: serial('id').primaryKey(),
    /** Engaged participant user ids, stored sorted ascending. GIN-searchable. */
    participantIds: integer('participant_ids').array().notNull(),
    /** sha1 hex of the sorted ids joined by ',' — see the header block. */
    participantHash: text('participant_hash').notNull(),
    /** `participant_ids.length`. Paired with the hash so exact-set equality
     *  cannot be satisfied by a hash collision across differing sizes. */
    cohortSize: smallint('cohort_size').notNull(),
    gameId: integer('game_id').notNull(),
    sourceLineupId: integer('source_lineup_id').notNull(),
    resolution: text('resolution', {
      enum: ['decided', 'match', 'veto_won', 'veto_lost'],
    }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Idempotency key for ON CONFLICT DO NOTHING on both write triggers and
    // the backfill migration.
    unique('uq_cl_cohort_memory_row').on(
      table.participantHash,
      table.gameId,
      table.sourceLineupId,
      table.resolution,
    ),
    // Diagnostics / future containment queries ("which cohorts included A?").
    index('idx_cl_cohort_memory_participants').using(
      'gin',
      table.participantIds,
    ),
    // The read path: exact-set lookup by (hash, size).
    index('idx_cl_cohort_memory_hash_size').on(
      table.participantHash,
      table.cohortSize,
    ),
    // ROK-1387: explicit FK names. `community_lineup_cohort_memory` is 30
    // chars, so the drizzle default for source_lineup_id would be
    // `community_lineup_cohort_memory_source_lineup_id_community_lineups_id_fk`
    // (71 chars) — silently truncated by Postgres at 63.
    foreignKey({
      columns: [table.gameId],
      foreignColumns: [games.id],
      name: 'cl_cohort_memory_game_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.sourceLineupId],
      foreignColumns: [communityLineups.id],
      name: 'cl_cohort_memory_source_lineup_id_fk',
    }).onDelete('cascade'),
  ],
);
