import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  numeric,
  unique,
} from 'drizzle-orm/pg-core';
import { communityLineups } from './community-lineups';
import { games } from './games';
import { events } from './events';
import { users } from './users';

// ============================================================
// Lineup Match Tables (ROK-964)
// ============================================================

/**
 * Game match groups derived from voting results.
 *
 * Each match represents a game that met (or nearly met) the lineup's
 * match threshold. Status flow: suggested -> scheduling -> scheduled -> archived.
 */
export const communityLineupMatches = pgTable(
  'community_lineup_matches',
  {
    id: serial('id').primaryKey(),
    lineupId: integer('lineup_id')
      .references(() => communityLineups.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status', {
      enum: ['suggested', 'scheduling', 'scheduled', 'archived'],
    })
      .default('suggested')
      .notNull(),
    thresholdMet: boolean('threshold_met').default(false).notNull(),
    voteCount: integer('vote_count').default(0).notNull(),
    votePercentage: numeric('vote_percentage', {
      precision: 5,
      scale: 2,
    }),
    fitType: text('fit_type', {
      enum: ['perfect', 'normal', 'oversubscribed', 'undersubscribed'],
    }),
    linkedEventId: integer('linked_event_id').references(() => events.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique('uq_lineup_match_game').on(table.lineupId, table.gameId)],
);

/**
 * Members assigned to a match group.
 *
 * Source tracks whether the member voted for the game directly
 * or was added via the bandwagon (interest-based) algorithm.
 */
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
    source: text('source', {
      enum: ['voted', 'bandwagon'],
    }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique('uq_match_member_user').on(table.matchId, table.userId)],
);

/**
 * Proposed time slots for scheduling a match.
 *
 * Slots can be system-generated (from availability overlap) or
 * manually proposed by a user.
 */
export const communityLineupScheduleSlots = pgTable(
  'community_lineup_schedule_slots',
  {
    id: serial('id').primaryKey(),
    matchId: integer('match_id')
      .references(() => communityLineupMatches.id, { onDelete: 'cascade' })
      .notNull(),
    proposedTime: timestamp('proposed_time').notNull(),
    overlapScore: numeric('overlap_score', {
      precision: 5,
      scale: 2,
    }),
    suggestedBy: text('suggested_by', {
      enum: ['system', 'user'],
    }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
);

/**
 * User votes on proposed schedule time slots.
 *
 * Each user may vote once per slot.
 */
export const communityLineupScheduleVotes = pgTable(
  'community_lineup_schedule_votes',
  {
    id: serial('id').primaryKey(),
    slotId: integer('slot_id')
      .references(() => communityLineupScheduleSlots.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique('uq_schedule_vote_user').on(table.slotId, table.userId)],
);
