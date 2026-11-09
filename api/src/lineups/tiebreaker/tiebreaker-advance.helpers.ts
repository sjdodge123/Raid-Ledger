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
import { ConflictException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pgErrorCode } from '../../common/pg-error.helpers';
import * as schema from '../../drizzle/schema';
import { countDistinctVoters } from '../lineups-query.helpers';
import { advanceBracket, getCurrentRound } from './tiebreaker-bracket.helpers';
import { countDistinctMatchupVoters } from './tiebreaker-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Advisory-lock class for bracket round advances (ROK-938). */
export const TIEBREAKER_ADVANCE_LOCK_CLASS = 938;

/**
 * How long a caller waits for the round-advance lock (or a matchup row lock
 * under it) before giving up — ROK-2098 review MAJOR-1.
 *
 * Every waiter holds a pooled connection while it waits. With Postgres's
 * default `lock_timeout = 0` a burst of ~pool-size waiters behind an admin
 * force-resolve would pin the pool until the holder finished. Bounding the
 * wait means a waiter always hands its connection back. (The holder does
 * all of its work on the lock's own `tx` — ROK-2098 Codex P1 — so it never
 * needs a second connection.) 5s is far above the holder's normal work (a
 * resolve, a flip and one matching rebuild — well under a second) yet short
 * enough that a pile-up drains quickly. It also bounds every row-lock wait
 * inside `fn`.
 */
export const TIEBREAKER_ADVANCE_LOCK_TIMEOUT = '5s';

/** SQLSTATE `lock_not_available` — raised when `lock_timeout` expires. */
const LOCK_NOT_AVAILABLE = '55P03';

/**
 * Run `fn` while holding the per-tiebreaker round-advance advisory lock.
 * The lock lives for the transaction `fn` receives; it is released when `fn`
 * settles. `fn` must run every query on that `tx` (never the outer `db`, which
 * would need a second pooled connection while this one is pinned) and must
 * fire no side effects — return what happened and act after commit. ROK-2098: the finalize path takes the same lock so a force-resolve
 * and a round-completing vote can never both advance or both finalize.
 * @throws ConflictException when the lock is not free within
 *   `TIEBREAKER_ADVANCE_LOCK_TIMEOUT` (the transaction has rolled back; the
 *   caller may retry — every step re-reads durable state).
 */
export async function withTiebreakerAdvanceLock<T>(
  db: Db,
  tiebreakerId: number,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      // SET LOCAL takes no bind parameters; the value is a constant.
      await tx.execute(
        sql.raw(
          `SET LOCAL lock_timeout = '${TIEBREAKER_ADVANCE_LOCK_TIMEOUT}'`,
        ),
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${TIEBREAKER_ADVANCE_LOCK_CLASS}::int4, ${tiebreakerId}::int4)`,
      );
      return fn(tx);
    });
  } catch (err) {
    // Mapped only AFTER the transaction rolled back — never caught and
    // retried inside it (postgres.js poisons a transaction on any failure).
    if (pgErrorCode(err) !== LOCK_NOT_AVAILABLE) throw err;
    throw new ConflictException(
      'This tiebreaker is being finalized right now. Please try again.',
    );
  }
}

/**
 * Advance the bracket if every lineup voter has voted on every open matchup
 * of the current round. Serialized per tiebreaker; at most one concurrent
 * caller advances a given round. ROK-2098: a tiebreaker that is no longer
 * `active` (an admin force-resolved it while this vote waited on the lock)
 * is never advanced again.
 * @returns the bracket's final winner game id when this call completed the
 *   bracket, else null (round still open, already advanced, tiebreaker no
 *   longer active, or a new round was created).
 */
export async function advanceRoundIfComplete(
  db: Db,
  tiebreakerId: number,
  lineupId: number,
): Promise<number | null> {
  return withTiebreakerAdvanceLock(db, tiebreakerId, async (tx) => {
    if (!(await isTiebreakerActive(tx, tiebreakerId))) return null;
    if (!(await isCurrentRoundComplete(tx, tiebreakerId, lineupId))) {
      return null;
    }
    return advanceBracket(tx, tiebreakerId);
  });
}

/** True while the tiebreaker row is still `active`. */
async function isTiebreakerActive(
  tx: Db,
  tiebreakerId: number,
): Promise<boolean> {
  const t = schema.communityLineupTiebreakers;
  const [row] = await tx
    .select({ status: t.status })
    .from(t)
    .where(eq(t.id, tiebreakerId))
    .limit(1);
  return row?.status === 'active';
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
