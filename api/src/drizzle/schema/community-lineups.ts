import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  smallint,
  unique,
  jsonb,
  varchar,
} from 'drizzle-orm/pg-core';
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
  /** Operator-authored title shown everywhere the lineup appears (ROK-1063). */
  title: varchar('title', { length: 100 }).notNull(),
  /** Optional operator-authored markdown description (ROK-1063). */
  description: text('description'),
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
    standalone?: boolean;
  } | null>(),
  /** Match threshold percentage for the matching algorithm (0–100, default 35). */
  matchThreshold: integer('match_threshold').notNull().default(35),
  /** Max votes each player can cast during voting (1–10, default 3, ROK-976). */
  maxVotesPerPlayer: smallint('max_votes_per_player').notNull().default(3),
  /** Default tiebreaker mode used when voting deadline expires (ROK-938). */
  defaultTiebreakerMode: text('default_tiebreaker_mode', {
    enum: ['bracket', 'veto'],
  }),
  /** Active tiebreaker FK (ROK-938). Null when no tiebreaker is active. */
  activeTiebreakerId: integer('active_tiebreaker_id'),
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
