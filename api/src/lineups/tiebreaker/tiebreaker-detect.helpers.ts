/**
 * Tie detection at the threshold boundary (ROK-938).
 * Detects when multiple games share the same vote count.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { countVotesPerGame } from '../lineups-query.helpers';

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
