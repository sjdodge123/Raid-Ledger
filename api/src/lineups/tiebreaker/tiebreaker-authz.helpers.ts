/**
 * Tiebreaker write authorization (ROK-1752).
 *
 * `bracket-vote` and `veto` used to trust the path lineup id and the body
 * `matchupId` blindly: any signed-in user could vote a matchup from another
 * lineup's bracket, pre-vote a resolved round, or spend a private lineup's
 * shared veto slot without being invited. These guards close both holes by
 * reusing the private-lineup gate every other lineup write path runs.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  assertUserCanParticipate,
  type EligibilityCaller,
} from '../lineups-eligibility.helpers';
import { getCurrentRound } from './tiebreaker-bracket.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Throw 403 when the caller may not participate in the lineup the
 * tiebreaker belongs to (private lineup, not creator/invitee/admin/operator).
 */
export async function assertCallerMayTiebreak(
  db: Db,
  lineupId: number,
  caller: EligibilityCaller,
): Promise<void> {
  const [lineup] = await db
    .select({
      id: schema.communityLineups.id,
      createdBy: schema.communityLineups.createdBy,
      visibility: schema.communityLineups.visibility,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) throw new NotFoundException('Lineup not found');
  await assertUserCanParticipate(db, lineup, caller);
}

/**
 * Throw unless `matchupId` is an open, non-bye matchup of THIS tiebreaker's
 * current round and `gameId` is one of its two games. A matchup from another
 * tiebreaker 404s (same shape as the scheduling slot-belongs-to-match guard),
 * so its existence does not leak; a stale or bye matchup is a 400.
 */
export async function assertMatchupVotable(
  db: Db,
  tiebreakerId: number,
  matchupId: number,
  gameId: number,
): Promise<void> {
  const m = schema.communityLineupTiebreakerBracketMatchups;
  const [matchup] = await db
    .select()
    .from(m)
    .where(and(eq(m.id, matchupId), eq(m.tiebreakerId, tiebreakerId)))
    .limit(1);
  if (!matchup) {
    throw new NotFoundException('Matchup not found in this tiebreaker');
  }
  const round = await getCurrentRound(db, tiebreakerId);
  if (matchup.round !== round || matchup.isBye || matchup.winnerGameId) {
    throw new BadRequestException('Matchup is not open in the current round');
  }
  if (gameId !== matchup.gameAId && gameId !== matchup.gameBId) {
    throw new BadRequestException('Game is not in this matchup');
  }
}

export interface BracketVoteInput {
  tiebreakerId: number;
  matchupId: number;
  userId: number;
  gameId: number;
}

/**
 * Insert a bracket vote ONLY while the matchup is still open (no winner, not
 * a bye). `FOR UPDATE` locks the matchup row against a concurrent
 * `setMatchupWinner` UPDATE, so a vote cannot land after the winner is set.
 * It does NOT serialize the advance's earlier vote COUNT (no transaction
 * there), so a vote committed between that count and the UPDATE is saved but
 * not counted — see TECH-DEBT-BACKLOG (checkAndAdvanceRound serialization).
 * Returns false when nothing was written: matchup closed, or a duplicate vote.
 */
export async function insertBracketVoteIfOpen(
  db: Db,
  vote: BracketVoteInput,
): Promise<boolean> {
  const m = schema.communityLineupTiebreakerBracketMatchups;
  const bv = schema.communityLineupTiebreakerBracketVotes;
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO ${bv} (matchup_id, user_id, game_id)
    SELECT ${m.id}, ${vote.userId}::int, ${vote.gameId}::int
    FROM ${m}
    WHERE ${m.id} = ${vote.matchupId}
      AND ${m.tiebreakerId} = ${vote.tiebreakerId}
      AND ${m.winnerGameId} IS NULL
      AND ${m.isBye} = false
    FOR UPDATE
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  return rows.length > 0;
}
