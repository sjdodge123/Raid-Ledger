/**
 * Matching algorithm for community lineups (ROK-936).
 * Runs on voting -> decided transition to create match records.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  countVotesPerGame,
  countDistinctVoters,
} from './lineups-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Fit category based on voter count vs game capacity. */
export type FitCategory =
  | 'perfect'
  | 'oversubscribed'
  | 'undersubscribed'
  | 'normal';

/**
 * Build match records for a lineup transitioning to 'decided'.
 * Creates community_lineup_matches and community_lineup_match_members rows.
 */
export async function buildMatchesForLineup(
  db: Db,
  lineupId: number,
): Promise<void> {
  const [lineup] = await db
    .select({ matchThreshold: schema.communityLineups.matchThreshold })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) return;

  const threshold = lineup.matchThreshold ?? 35;
  const [voteCounts, voterRows] = await Promise.all([
    countVotesPerGame(db, lineupId),
    countDistinctVoters(db, lineupId),
  ]);

  const totalVoters = voterRows[0]?.total ?? 0;
  if (totalVoters === 0) return;

  for (const vc of voteCounts) {
    if (vc.voteCount === 0) continue;
    await insertMatch(db, lineupId, vc, totalVoters, threshold);
  }
}

/** Insert a single match row and its member rows. */
async function insertMatch(
  db: Db,
  lineupId: number,
  vc: { gameId: number; voteCount: number },
  totalVoters: number,
  threshold: number,
): Promise<void> {
  const pct = (vc.voteCount / totalVoters) * 100;
  const status: 'scheduling' | 'suggested' =
    pct >= threshold ? 'scheduling' : 'suggested';
  const fitCategory = await computeFitCategory(db, vc.gameId, vc.voteCount);

  const [match] = await db
    .insert(schema.communityLineupMatches)
    .values({
      lineupId,
      gameId: vc.gameId,
      status,
      thresholdMet: status === 'scheduling',
      voteCount: vc.voteCount,
      votePercentage: pct.toFixed(2),
      fitType: fitCategory,
    })
    .returning({ id: schema.communityLineupMatches.id });

  await insertMatchMembers(db, lineupId, match.id, vc.gameId);
}

/** Determine fit category from voter count and game player limits. */
async function computeFitCategory(
  db: Db,
  gameId: number,
  voterCount: number,
): Promise<FitCategory> {
  const [game] = await db
    .select({ playerCount: schema.games.playerCount })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);

  if (!game?.playerCount) return 'normal';
  const { min, max } = game.playerCount;
  if (voterCount > max) return 'oversubscribed';
  if (voterCount < min) return 'undersubscribed';
  return 'perfect';
}

/** Insert match member rows for all voters of a specific game. */
async function insertMatchMembers(
  db: Db,
  lineupId: number,
  matchId: number,
  gameId: number,
): Promise<void> {
  const rows = await db
    .select({ userId: schema.communityLineupVotes.userId })
    .from(schema.communityLineupVotes)
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.gameId, gameId),
      ),
    );
  if (rows.length === 0) return;

  await db.insert(schema.communityLineupMatchMembers).values(
    rows.map((r) => ({
      matchId,
      userId: r.userId,
      source: 'voted' as const,
    })),
  );
}
