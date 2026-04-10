/**
 * Tiebreaker DB read queries (ROK-938).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Find a tiebreaker by ID. */
export function findTiebreakerById(db: Db, tiebreakerId: number) {
  return db
    .select()
    .from(schema.communityLineupTiebreakers)
    .where(eq(schema.communityLineupTiebreakers.id, tiebreakerId))
    .limit(1);
}

/** Find the active tiebreaker for a lineup. */
export function findActiveTiebreaker(db: Db, lineupId: number) {
  return db
    .select()
    .from(schema.communityLineupTiebreakers)
    .where(
      and(
        eq(schema.communityLineupTiebreakers.lineupId, lineupId),
        eq(schema.communityLineupTiebreakers.status, 'active'),
      ),
    )
    .limit(1);
}

/** Find any non-dismissed tiebreaker for a lineup. */
export function findPendingOrActiveTiebreaker(db: Db, lineupId: number) {
  return db
    .select()
    .from(schema.communityLineupTiebreakers)
    .where(
      and(
        eq(schema.communityLineupTiebreakers.lineupId, lineupId),
        sql`${schema.communityLineupTiebreakers.status} != 'dismissed'`,
      ),
    )
    .limit(1);
}

/** Find all matchups for a tiebreaker. */
export function findMatchups(db: Db, tiebreakerId: number) {
  return db
    .select()
    .from(schema.communityLineupTiebreakerBracketMatchups)
    .where(
      eq(
        schema.communityLineupTiebreakerBracketMatchups.tiebreakerId,
        tiebreakerId,
      ),
    );
}

/** Count votes per game for a matchup. */
export function countMatchupVotes(db: Db, matchupId: number) {
  return db
    .select({
      gameId: schema.communityLineupTiebreakerBracketVotes.gameId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.communityLineupTiebreakerBracketVotes)
    .where(
      eq(schema.communityLineupTiebreakerBracketVotes.matchupId, matchupId),
    )
    .groupBy(schema.communityLineupTiebreakerBracketVotes.gameId);
}

/** Find a user's bracket vote for a matchup. */
export function findUserBracketVote(db: Db, matchupId: number, userId: number) {
  return db
    .select({ gameId: schema.communityLineupTiebreakerBracketVotes.gameId })
    .from(schema.communityLineupTiebreakerBracketVotes)
    .where(
      and(
        eq(schema.communityLineupTiebreakerBracketVotes.matchupId, matchupId),
        eq(schema.communityLineupTiebreakerBracketVotes.userId, userId),
      ),
    )
    .limit(1);
}

/** Find all vetoes for a tiebreaker. */
export function findVetoes(db: Db, tiebreakerId: number) {
  return db
    .select()
    .from(schema.communityLineupTiebreakerVetoes)
    .where(
      eq(schema.communityLineupTiebreakerVetoes.tiebreakerId, tiebreakerId),
    );
}

/** Reset pending/active tiebreakers for a lineup. Preserves resolved ones. */
export async function resetTiebreaker(db: Db, lineupId: number): Promise<void> {
  await db
    .update(schema.communityLineupTiebreakers)
    .set({ status: 'dismissed', updatedAt: new Date() })
    .where(
      and(
        eq(schema.communityLineupTiebreakers.lineupId, lineupId),
        sql`${schema.communityLineupTiebreakers.status} IN ('pending', 'active')`,
      ),
    );
  await db
    .update(schema.communityLineups)
    .set({ activeTiebreakerId: null, updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
}

/** Count distinct voters for a matchup. */
export async function countDistinctMatchupVoters(
  db: Db,
  matchupId: number,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct user_id)::int`.as('count') })
    .from(schema.communityLineupTiebreakerBracketVotes)
    .where(eq(schema.communityLineupTiebreakerBracketVotes.matchupId, matchupId));
  return row?.count ?? 0;
}

/** Find a user's veto for a tiebreaker. */
export function findUserVeto(db: Db, tiebreakerId: number, userId: number) {
  return db
    .select()
    .from(schema.communityLineupTiebreakerVetoes)
    .where(
      and(
        eq(schema.communityLineupTiebreakerVetoes.tiebreakerId, tiebreakerId),
        eq(schema.communityLineupTiebreakerVetoes.userId, userId),
      ),
    )
    .limit(1);
}
