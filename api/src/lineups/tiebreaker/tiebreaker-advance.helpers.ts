/**
 * Serialized bracket round-advance (ROK-938 follow-up, tech-debt 2026-10-10).
 *
 * Two final votes that each complete a round used to both pass the
 * "everyone voted" check and both call `advanceBracket`, creating the next
 * round twice (or resolving the next round with zero votes). The check and
 * the advance now run in ONE transaction that first takes a per-tiebreaker
 * advisory lock, then re-reads the round with the transaction handle, so the
 * second caller sees the round already advanced and does nothing.
 *
 * The matchup rows are also read `FOR UPDATE`: `insertBracketVoteIfOpen`
 * locks the same row, so a vote either committed before the count (and is
 * counted) or waits until the winner is set (and is refused) — it can no
 * longer be stored but not counted.
 *
 * Two-argument `pg_advisory_xact_lock(int4, int4)` form like
 * `scheduling-member-lock.helpers.ts`, so the keyspace is disjoint from the
 * one-argument `(bigint)` locks. `938` is the tiebreaker story id. A lock
 * instead of catch-and-retry because postgres.js poisons the whole
 * transaction on a failed statement. Side effects (resolve, phase transition,
 * notifications) belong to the caller AFTER this returns.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { countDistinctVoters } from '../lineups-query.helpers';
import { advanceBracket, getCurrentRound } from './tiebreaker-bracket.helpers';
import { countDistinctMatchupVoters } from './tiebreaker-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Advisory-lock class for bracket round advances (ROK-938). */
export const TIEBREAKER_ADVANCE_LOCK_CLASS = 938;

/**
 * Advance the bracket if every lineup voter has voted on every open matchup
 * of the current round. Serialized per tiebreaker; at most one concurrent
 * caller advances a given round.
 * @returns the bracket's final winner game id when this call completed the
 *   bracket, else null (round still open, already advanced, or a new round
 *   was created).
 */
export async function advanceRoundIfComplete(
  db: Db,
  tiebreakerId: number,
  lineupId: number,
): Promise<number | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${TIEBREAKER_ADVANCE_LOCK_CLASS}::int4, ${tiebreakerId}::int4)`,
    );
    if (!(await isCurrentRoundComplete(tx, tiebreakerId, lineupId))) {
      return null;
    }
    return advanceBracket(tx, tiebreakerId);
  });
}

/** True when the current round has open matchups and all are fully voted. */
async function isCurrentRoundComplete(
  tx: Db,
  tiebreakerId: number,
  lineupId: number,
): Promise<boolean> {
  const matchups = await lockMatchups(tx, tiebreakerId);
  const round = await getCurrentRound(tx, tiebreakerId);
  const open = matchups.filter(
    (m) => m.round === round && !m.isBye && !m.winnerGameId,
  );
  if (open.length === 0) return false;
  const required = await requiredVoteCount(tx, tiebreakerId, lineupId);
  for (const m of open) {
    if ((await countDistinctMatchupVoters(tx, m.id)) < required) return false;
  }
  return true;
}

/** Read every matchup of the tiebreaker `FOR UPDATE`, in a stable order. */
function lockMatchups(tx: Db, tiebreakerId: number) {
  const m = schema.communityLineupTiebreakerBracketMatchups;
  return tx
    .select()
    .from(m)
    .where(eq(m.tiebreakerId, tiebreakerId))
    .orderBy(m.id)
    .for('update');
}

/** Only people who voted in the lineup need to vote in the bracket. */
async function requiredVoteCount(
  tx: Db,
  tiebreakerId: number,
  lineupId: number,
): Promise<number> {
  const t = schema.communityLineupTiebreakers;
  const [tb] = await tx
    .select({ lineupId: t.lineupId })
    .from(t)
    .where(eq(t.id, tiebreakerId))
    .limit(1);
  const [voters] = await countDistinctVoters(tx, tb?.lineupId ?? lineupId);
  return voters?.total ?? 1;
}
