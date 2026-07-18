/**
 * Community Lineup Tiebreaker tables (ROK-938).
 *
 * Four tables for bracket and veto tiebreaker resolution modes:
 * - community_lineup_tiebreakers: main tiebreaker record
 * - community_lineup_tiebreaker_bracket_matchups: bracket pairings
 * - community_lineup_tiebreaker_bracket_votes: bracket round votes
 * - community_lineup_tiebreaker_vetoes: veto submissions
 */
import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  smallint,
  boolean,
  jsonb,
  unique,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { communityLineups } from './community-lineups';
import { games } from './games';
import { users } from './users';

export type TiebreakerMode = 'bracket' | 'veto';
export type TiebreakerStatus = 'pending' | 'active' | 'resolved' | 'dismissed';

/** Main tiebreaker record. */
export const communityLineupTiebreakers = pgTable(
  'community_lineup_tiebreakers',
  {
    id: serial('id').primaryKey(),
    lineupId: integer('lineup_id')
      .references(() => communityLineups.id, { onDelete: 'cascade' })
      .notNull(),
    mode: text('mode', { enum: ['bracket', 'veto'] }).notNull(),
    status: text('status', {
      enum: ['pending', 'active', 'resolved', 'dismissed'],
    })
      .default('pending')
      .notNull(),
    tiedGameIds: jsonb('tied_game_ids').$type<number[]>().notNull(),
    originalVoteCount: integer('original_vote_count').notNull(),
    winnerGameId: integer('winner_game_id').references(() => games.id),
    roundDeadline: timestamp('round_deadline'),
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
);

/** Bracket matchup pairings. */
export const communityLineupTiebreakerBracketMatchups = pgTable(
  'community_lineup_tiebreaker_bracket_matchups',
  {
    id: serial('id').primaryKey(),
    tiebreakerId: integer('tiebreaker_id').notNull(),
    round: smallint('round').notNull(),
    position: smallint('position').notNull(),
    gameAId: integer('game_a_id').notNull(),
    gameBId: integer('game_b_id'),
    winnerGameId: integer('winner_game_id'),
    isBye: boolean('is_bye').default(false).notNull(),
  },
  (table) => [
    unique('uq_tiebreaker_matchup_round_pos').on(
      table.tiebreakerId,
      table.round,
      table.position,
    ),
    // ROK-1387: explicit FK names — the drizzle defaults exceed Postgres's
    // 63-char identifier limit and were being silently truncated.
    foreignKey({
      columns: [table.tiebreakerId],
      foreignColumns: [communityLineupTiebreakers.id],
      name: 'cl_tb_bracket_matchups_tiebreaker_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.gameAId],
      foreignColumns: [games.id],
      name: 'cl_tb_bracket_matchups_game_a_id_fk',
    }),
    foreignKey({
      columns: [table.gameBId],
      foreignColumns: [games.id],
      name: 'cl_tb_bracket_matchups_game_b_id_fk',
    }),
    foreignKey({
      columns: [table.winnerGameId],
      foreignColumns: [games.id],
      name: 'cl_tb_bracket_matchups_winner_game_id_fk',
    }),
  ],
);

/** Bracket round votes (one per user per matchup). */
export const communityLineupTiebreakerBracketVotes = pgTable(
  'community_lineup_tiebreaker_bracket_votes',
  {
    id: serial('id').primaryKey(),
    matchupId: integer('matchup_id').notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id)
      .notNull(),
  },
  (table) => [
    unique('uq_tiebreaker_bracket_vote').on(table.matchupId, table.userId),
    // ROK-1387: explicit FK name (default exceeded the 63-char limit).
    foreignKey({
      columns: [table.matchupId],
      foreignColumns: [communityLineupTiebreakerBracketMatchups.id],
      name: 'cl_tb_bracket_votes_matchup_id_fk',
    }).onDelete('cascade'),
  ],
);

/** Veto submissions (one per user per tiebreaker). */
export const communityLineupTiebreakerVetoes = pgTable(
  'community_lineup_tiebreaker_vetoes',
  {
    id: serial('id').primaryKey(),
    tiebreakerId: integer('tiebreaker_id').notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id)
      .notNull(),
    revealed: boolean('revealed').default(false).notNull(),
  },
  (table) => [
    unique('uq_tiebreaker_veto_user').on(table.tiebreakerId, table.userId),
    // ROK-1387: explicit FK name (default exceeded the 63-char limit).
    foreignKey({
      columns: [table.tiebreakerId],
      foreignColumns: [communityLineupTiebreakers.id],
      name: 'cl_tb_vetoes_tiebreaker_id_fk',
    }).onDelete('cascade'),
  ],
);
