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
 *
 * The admin force-resolve (`forceAdvanceBracket`) takes the same lock, so a
 * force-resolve racing a round-completing vote cannot advance twice either.
 */
import { NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { countDistinctVoters } from '../lineups-query.helpers';
import { advanceBracket, getCurrentRound } from './tiebreaker-bracket.helpers';
import { defined } from '../../common/defined.helpers';
import {
  countDistinctMatchupVoters,
  findMatchups,
} from './tiebreaker-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type MatchupRow =
  typeof schema.communityLineupTiebreakerBracketMatchups.$inferSelect;

/** Advisory-lock class for bracket round advances (ROK-938). */
export const TIEBREAKER_ADVANCE_LOCK_CLASS = 938;

/**
 * Run `fn` in one transaction holding the per-tiebreaker round-advance lock.
 * Every path that advances or resolves a bracket (the vote path and the
 * admin force-resolve) goes through here, so they serialize against each
 * other. Do every read and write on the `tx` handed to `fn`.
 */
export function withTiebreakerAdvanceLock<T>(
  db: Db,
  tiebreakerId: number,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${TIEBREAKER_ADVANCE_LOCK_CLASS}::int4, ${tiebreakerId}::int4)`,
    );
    return fn(tx);
  });
}

/**
 * Advance the bracket if every lineup voter has voted on every open matchup
 * of the current round. Serialized per tiebreaker; at most one concurrent
 * caller advances a given round.
 * @returns the bracket's final winner game id when this call completed the
 *   bracket, else null (round still open, already advanced, or a new round
 *   was created).
 */
export function advanceRoundIfComplete(
  db: Db,
  tiebreakerId: number,
  lineupId: number,
): Promise<number | null> {
  return withTiebreakerAdvanceLock(db, tiebreakerId, async (tx) => {
    if (!(await isCurrentRoundComplete(tx, tiebreakerId, lineupId))) {
      return null;
    }
    return advanceBracket(tx, tiebreakerId);
  });
}

/** Outcome of an admin force-advance of a bracket tiebreaker. */
export interface ForcedBracketOutcome {
  winnerGameId: number;
  /** True when a racing vote had already resolved the tiebreaker. */
  alreadyResolved: boolean;
}

/**
 * Force-advance a bracket (admin `forceResolve`) under the round-advance
 * lock. Re-checks inside the lock that the tiebreaker is still unresolved:
 * if a racing vote already resolved it, writes nothing and returns that
 * winner with `alreadyResolved: true`. Otherwise resolves the current round
 * (creating the next one if it was not the final) and returns the final
 * winner, or — bracket still open — the first decided matchup's winner,
 * falling back to the top tied game. The caller resolves AFTER commit.
 */
export function forceAdvanceBracket(
  db: Db,
  tiebreakerId: number,
): Promise<ForcedBracketOutcome> {
  return withTiebreakerAdvanceLock(db, tiebreakerId, async (tx) => {
    const tb = await readTiebreakerState(tx, tiebreakerId);
    if (tb.status === 'resolved' && tb.winnerGameId !== null) {
      return { winnerGameId: tb.winnerGameId, alreadyResolved: true };
    }
    await lockMatchups(tx, tiebreakerId);
    const final = await advanceBracket(tx, tiebreakerId);
    if (final) return { winnerGameId: final, alreadyResolved: false };
    const decided = (await findMatchups(tx, tiebreakerId)).find(
      (m) => m.winnerGameId,
    );
    const winnerGameId =
      decided?.winnerGameId ?? defined(tb.tiedGameIds[0], 'top tied game');
    return { winnerGameId, alreadyResolved: false };
  });
}

/** Status, winner and tied games of a tiebreaker, read on the lock's tx. */
async function readTiebreakerState(
  tx: Db,
  tiebreakerId: number,
): Promise<{
  status: string;
  winnerGameId: number | null;
  tiedGameIds: number[];
}> {
  const t = schema.communityLineupTiebreakers;
  const [tb] = await tx
    .select({
      status: t.status,
      winnerGameId: t.winnerGameId,
      tiedGameIds: t.tiedGameIds,
    })
    .from(t)
    .where(eq(t.id, tiebreakerId))
    .limit(1);
  if (!tb) throw new NotFoundException('No tiebreaker found');
  return tb;
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
function lockMatchups(tx: Db, tiebreakerId: number): Promise<MatchupRow[]> {
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
