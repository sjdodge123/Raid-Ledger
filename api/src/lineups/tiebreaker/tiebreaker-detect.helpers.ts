/**
 * Tie detection at the threshold boundary (ROK-938).
 * Detects when multiple games share the same vote count.
 */
import { BadRequestException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UpdateLineupStatusDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { countVotesPerGame } from '../lineups-query.helpers';
import { findResolvedTiebreakerWinner } from './tiebreaker-query.helpers';
import { resetTiebreaker } from './tiebreaker-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Result of tie detection. Null when no tie exists. */
export interface TieResult {
  tiedGameIds: number[];
  voteCount: number;
}

/**
 * Detect tied games at the top of the vote leaderboard.
 * A tie exists when 2+ games share the highest vote count.
 * Returns null if no tie or fewer than 2 games have votes.
 */
export async function detectTies(
  db: Db,
  lineupId: number,
): Promise<TieResult | null> {
  const voteCounts = await countVotesPerGame(db, lineupId);
  if (voteCounts.length < 2) return null;

  const sorted = [...voteCounts].sort((a, b) => b.voteCount - a.voteCount);
  const topCount = sorted[0].voteCount;
  if (topCount === 0) return null;

  const tied = sorted.filter((v) => v.voteCount === topCount);
  if (tied.length < 2) return null;

  return {
    tiedGameIds: tied.map((v) => v.gameId),
    voteCount: topCount,
  };
}

/**
 * Guard for voting → decided transition.
 * Blocks if ties exist (unless a resolved tiebreaker exists).
 * Overrides decidedGameId with tiebreaker winner when applicable.
 * Resets tiebreaker state when reverting away from voting.
 */
export async function guardTiebreakerOnTransition(
  db: Db,
  lineupId: number,
  currentStatus: string,
  dto: UpdateLineupStatusDto,
): Promise<void> {
  if (currentStatus === 'voting' && dto.status === 'decided') {
    const winner = await findResolvedTiebreakerWinner(db, lineupId);
    if (winner) {
      dto.decidedGameId = winner;
    } else {
      const ties = await detectTies(db, lineupId);
      if (ties) {
        throw new BadRequestException({
          message: 'TIEBREAKER_REQUIRED',
          tiedGameIds: ties.tiedGameIds,
          voteCount: ties.voteCount,
        });
      }
    }
    return;
  }
  // Auto-reset when leaving voting for non-decided status
  if (currentStatus === 'voting' && dto.status !== 'voting') {
    await resetTiebreaker(db, lineupId);
  }
}
