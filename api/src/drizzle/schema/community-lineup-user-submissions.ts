import {
  pgTable,
  serial,
  timestamp,
  integer,
  unique,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { communityLineups } from './community-lineups';
import { users } from './users';

/**
 * Per-(lineup, user) submission timestamps (ROK-1296, U4 SubmitBar).
 *
 * Storage backing the universal Submit ritual: a row is upserted whenever a
 * member explicitly commits to a phase via the SubmitBar's CTA. Autosave
 * touches (nominations, votes) do NOT write here — only the explicit
 * `submit-votes` endpoint stamps `votes_submitted_at`.
 *
 * `checkVotingQuorum` reads `votes_submitted_at` to decide auto-advance: every
 * expected voter must have stamped it before the lineup may advance.
 *
 * TDB:449: `nominations_submitted_at` is retained but no longer written — the
 * `submit-nominations` endpoint is retired and building quorum advances on
 * the nomination count target instead. A lineup revert still clears it.
 *
 * Re-submission overwrites the timestamp to `now()` — the table is an
 * upsert target (unique on `(lineup_id, user_id)`), not an append log.
 */
export const communityLineupUserSubmissions = pgTable(
  'community_lineup_user_submissions',
  {
    id: serial('id').primaryKey(),
    lineupId: integer('lineup_id').notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Retained, no longer written (TDB:449); a revert still clears it. */
    nominationsSubmittedAt: timestamp('nominations_submitted_at'),
    /** Stamped when the user explicitly submits during the voting phase. */
    votesSubmittedAt: timestamp('votes_submitted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_lineup_user_submission').on(table.lineupId, table.userId),
    // ROK-1387: explicit FK name (default exceeded the 63-char limit).
    foreignKey({
      columns: [table.lineupId],
      foreignColumns: [communityLineups.id],
      name: 'cl_user_submissions_lineup_id_fk',
    }).onDelete('cascade'),
  ],
);
