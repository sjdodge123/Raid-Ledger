/**
 * Atomic bracket vote (overnight backlog triage 2026-11-09, found in the
 * ROK-2098 review).
 *
 * The vote used to commit on the outer pool BEFORE the round-advance lock
 * was taken, and the finalize ran in a second transaction. A busy lock (409)
 * or a failing matching pass then errored the caller while their vote — and,
 * for a bracket-completing vote, the round advance — stayed committed: the
 * retry hit a closed matchup (400) and the lineup was stranded in `voting`.
 *
 * Now the insert, the round-advance check and the finalize run in ONE
 * transaction under `withTiebreakerAdvanceLock`, so an error means nothing
 * was stored and a retry redoes it all from durable state. No catch-and-retry
 * inside the transaction (postgres.js poisons it on a failed statement); the
 * poll-card / cohort-memory side effects run only after it commits.
 */
import type { BracketVoteInput } from './tiebreaker-authz.helpers';
import { insertBracketVoteIfOpen } from './tiebreaker-authz.helpers';
import {
  advanceRoundInTx,
  withTiebreakerAdvanceLock,
} from './tiebreaker-advance.helpers';
import type { TiebreakerDecideDeps } from './tiebreaker-decide.helpers';
import {
  announceFinalized,
  finalizeUnderLock,
  type FinalizeOutcome,
} from './tiebreaker-finalize.helpers';

type Db = TiebreakerDecideDeps['db'];

/** What an atomic bracket vote did. */
export interface BracketVoteResult {
  /** False on a duplicate vote or a matchup closed before the insert. */
  inserted: boolean;
  /** The tiebreaker's winner when this vote completed the bracket. */
  winner: number | null;
}

/**
 * Store a bracket vote and, if it completes the round (or the bracket),
 * advance and finalize — all under the per-tiebreaker round-advance lock.
 * @throws ConflictException when the lock is busy; nothing is stored.
 */
export async function castBracketVoteAtomically(
  deps: TiebreakerDecideDeps,
  vote: BracketVoteInput,
  lineupId: number,
): Promise<BracketVoteResult> {
  const { tiebreakerId } = vote;
  const done = await withTiebreakerAdvanceLock(deps.db, tiebreakerId, (tx) =>
    voteUnderLock(tx, vote, lineupId),
  );
  if (done.outcome) {
    await announceFinalized(deps, tiebreakerId, done.outcome);
  }
  return { inserted: done.inserted, winner: done.outcome?.winner ?? null };
}

/** The locked part: insert, advance, finalize — every query on `tx`. */
async function voteUnderLock(
  tx: Db,
  vote: BracketVoteInput,
  lineupId: number,
): Promise<{ inserted: boolean; outcome: FinalizeOutcome | null }> {
  const inserted = await insertBracketVoteIfOpen(tx, vote);
  const winner = await advanceRoundInTx(tx, vote.tiebreakerId, lineupId);
  if (!winner) return { inserted, outcome: null };
  const outcome = await finalizeUnderLock(tx, vote.tiebreakerId, () =>
    Promise.resolve(winner),
  );
  return { inserted, outcome };
}
