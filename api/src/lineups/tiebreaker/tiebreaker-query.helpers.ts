/**
 * Tiebreaker DB read queries (ROK-938).
 */
import { and, eq, gte, sql } from 'drizzle-orm';
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

/** ROK-2098: one tiebreaker row by id, or null. */
export async function findTiebreakerRow(
  db: Db,
  tiebreakerId: number,
): Promise<typeof schema.communityLineupTiebreakers.$inferSelect | null> {
  const [row] = await findTiebreakerById(db, tiebreakerId);
  return row ?? null;
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
    .where(
      eq(schema.communityLineupTiebreakerBracketVotes.matchupId, matchupId),
    );
  return row?.count ?? 0;
}

/** Find resolved tiebreaker for a lineup. Returns winner game ID or null. */
export async function findResolvedTiebreakerWinner(
  db: Db,
  lineupId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ winnerGameId: schema.communityLineupTiebreakers.winnerGameId })
    .from(schema.communityLineupTiebreakers)
    .where(
      and(
        eq(schema.communityLineupTiebreakers.lineupId, lineupId),
        eq(schema.communityLineupTiebreakers.status, 'resolved'),
      ),
    )
    .limit(1);
  return row?.winnerGameId ?? null;
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

/** What a tiebreaker finalize needs to know about its lineup (ROK-2098). */
export interface LineupDecideState {
  status: typeof schema.communityLineups.$inferSelect.status;
  /** True when a match group was created at or after the `since` bound. */
  hasMatches: boolean;
}

/**
 * ROK-2098: read the lineup's phase and whether matching has produced a
 * match group since `since`. `rebuildMatches` wipes and inserts in ONE
 * transaction, so a match row is durable proof that a matching pass
 * completed — but only a row created after the tiebreaker began counts.
 * A lineup that was decided, reverted to voting and then tiebroken keeps its
 * earlier round's rows until the next rebuild; counted as "done" they would
 * stop a repair retry and leave the lineup wired to the old game's poll
 * (the ROK-1306 wrong-game-link). Review MINOR-1.
 *
 * @param since - the tiebreaker's `createdAt`. Both it and the match
 *   `createdAt` are stamped by the database clock (`defaultNow()`), unlike the
 *   app-stamped `resolvedAt`, so no app/DB clock skew can misorder them.
 */
export async function findLineupDecideState(
  db: Db,
  lineupId: number,
  since: Date,
): Promise<LineupDecideState | null> {
  const [lineup] = await db
    .select({ status: schema.communityLineups.status })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) return null;
  const matches = schema.communityLineupMatches;
  const [match] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.lineupId, lineupId), gte(matches.createdAt, since)))
    .limit(1);
  return { status: lineup.status, hasMatches: match !== undefined };
}
