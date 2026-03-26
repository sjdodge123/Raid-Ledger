import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  unique,
  jsonb,
  numeric,
} from 'drizzle-orm/pg-core';
/* numeric import retained for communityLineupMatches.voterPercentage */
import { users } from './users';
import { games } from './games';
import { events } from './events';

export type LineupStatus = 'building' | 'voting' | 'decided' | 'archived';

/**
 * Community Lineups — collaborative game selection (ROK-933).
 *
 * Status flow: building → voting → decided → archived
 * Only one lineup may be in `building` or `voting` at a time.
 */
export const communityLineups = pgTable('community_lineups', {
  id: serial('id').primaryKey(),
  status: text('status', {
    enum: ['building', 'voting', 'decided', 'archived'],
  })
    .default('building')
    .notNull(),
  targetDate: timestamp('target_date'),
  decidedGameId: integer('decided_game_id').references(() => games.id),
  linkedEventId: integer('linked_event_id').references(() => events.id),
  createdBy: integer('created_by')
    .references(() => users.id)
    .notNull(),
  votingDeadline: timestamp('voting_deadline'),
  phaseDeadline: timestamp('phase_deadline'),
  phaseDurationOverride: jsonb('phase_duration_override').$type<{
    building?: number;
    voting?: number;
    decided?: number;
  } | null>(),
  /** Match threshold percentage for the matching algorithm (0–100, default 35). */
  matchThreshold: integer('match_threshold').notNull().default(35),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Individual game nominations within a lineup. */
export const communityLineupEntries = pgTable(
  'community_lineup_entries',
  {
    id: serial('id').primaryKey(),
    lineupId: integer('lineup_id')
      .references(() => communityLineups.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    nominatedBy: integer('nominated_by')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    note: text('note'),
    carriedOverFrom: integer('carried_over_from').references(
      () => communityLineups.id,
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique('uq_lineup_entry_game').on(table.lineupId, table.gameId)],
);

/** User votes on nominated games. */
export const communityLineupVotes = pgTable(
  'community_lineup_votes',
  {
    id: serial('id').primaryKey(),
    lineupId: integer('lineup_id')
      .references(() => communityLineups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    /** Reserved for future ranked-choice voting. */
    rank: integer('rank'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_lineup_vote_user_game').on(
      table.lineupId,
      table.userId,
      table.gameId,
    ),
  ],
);

/** Match results computed on voting -> decided transition (ROK-936). */
export const communityLineupMatches = pgTable('community_lineup_matches', {
  id: serial('id').primaryKey(),
  lineupId: integer('lineup_id')
    .references(() => communityLineups.id, { onDelete: 'cascade' })
    .notNull(),
  gameId: integer('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  status: text('status').notNull(),
  voteCount: integer('vote_count').notNull(),
  voterPercentage: numeric('voter_percentage', {
    precision: 5,
    scale: 2,
  }).notNull(),
  fitCategory: text('fit_category').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Members associated with each match (voters for that game). */
export const communityLineupMatchMembers = pgTable(
  'community_lineup_match_members',
  {
    id: serial('id').primaryKey(),
    matchId: integer('match_id')
      .references(() => communityLineupMatches.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
);
