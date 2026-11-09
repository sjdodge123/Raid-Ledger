/**
 * ROK-2098 — once-only, repairable tiebreaker finalize.
 *
 * Both the round-completing vote (`checkAndAdvanceRound`) and an admin
 * `forceResolve` end in resolve → clear → decided flip → matching. Run
 * unguarded, a force-resolve racing the final vote did all of it twice, and
 * the second matching pass wiped and rebuilt the match groups, so the Discord
 * poll cards posted, were deleted and posted again.
 *
 * Every step is now decided from DURABLE state, re-read under the
 * per-tiebreaker round-advance lock (`withTiebreakerAdvanceLock`):
 *   - winner: a `resolved` row keeps its stored winner; otherwise the
 *     caller's picker runs (the force path's bracket advance therefore runs
 *     under the same lock as the vote path's — no double advance);
 *   - decide: the lineup still in `voting`, or `decided` with no match group
 *     created since the tiebreaker began, needs the flip + matching pass;
 *     `decided` WITH such a group (or any later phase) is complete and is
 *     left alone. Older groups from an earlier, reverted decide do not count.
 *
 * Every read and write under the lock runs on the lock's `tx` (Codex P1):
 * work on the outer pool while the lock transaction pins a pooled connection
 * self-deadlocks at `DB_POOL_MAX=1` and lets concurrent finalizers exhaust a
 * larger pool. One transaction also makes the finalize atomic — a failure
 * anywhere (matching included: on `tx` it throws instead of swallowing) rolls
 * the whole thing back, and a retry redoes it from durable state. A second
 * concurrent caller waits for the lock, finds the work done and returns.
 *
 * Side effects run only AFTER the transaction commits, and only for the
 * caller that did the work: the poll-card events (their listeners read the
 * committed match rows on other connections) and the best-effort cohort
 * memory writes (they swallow errors, which would poison the transaction).
 */
import type * as schema from '../../drizzle/schema';
import type { MatchingPassResult } from '../lineups-matching.helpers';
import { writeTiebreakerCohortMemory } from '../cohort-memory-write.helpers';
import { withTiebreakerAdvanceLock } from './tiebreaker-advance.helpers';
import {
  announceLineupDecided,
  decideLineupInTx,
  type TiebreakerDecideDeps,
} from './tiebreaker-decide.helpers';
import {
  clearActiveTiebreaker,
  markTiebreakerResolved,
} from './tiebreaker-lifecycle.helpers';
import {
  findLineupDecideState,
  findTiebreakerRow,
} from './tiebreaker-query.helpers';

type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;
type Db = TiebreakerDecideDeps['db'];

/**
 * Picks the winner of a tiebreaker that has not been resolved yet. `tx` is
 * the round-advance-lock transaction — every query the picker runs MUST use
 * it, never the outer pool.
 */
export type WinnerPicker = (tb: TiebreakerRow, tx: Db) => Promise<number>;

/** What the locked transaction did, for the after-commit side effects. */
interface FinalizeOutcome {
  winner: number;
  lineupId: number;
  /** True when THIS call resolved the row (writes the veto cohort memory). */
  resolvedNow: boolean;
  /** The matching pass this call ran, or null when decide was complete. */
  pass: MatchingPassResult | null;
}

/**
 * Resolve (if needed), detach, and decide the lineup of a tiebreaker —
 * completing only the steps durable state says are missing.
 * @returns the winning game id, or null when the tiebreaker is gone or
 *   dismissed (nothing to finalize).
 */
export async function finalizeTiebreaker(
  deps: TiebreakerDecideDeps,
  tiebreakerId: number,
  pickWinner: WinnerPicker,
): Promise<number | null> {
  const outcome = await withTiebreakerAdvanceLock(deps.db, tiebreakerId, (tx) =>
    finalizeUnderLock(tx, tiebreakerId, pickWinner),
  );
  if (!outcome) return null;
  await announceFinalized(deps, tiebreakerId, outcome);
  return outcome.winner;
}

/** The locked part: every query on `tx`, no side effects. */
async function finalizeUnderLock(
  tx: Db,
  tiebreakerId: number,
  pickWinner: WinnerPicker,
): Promise<FinalizeOutcome | null> {
  const tb = await findTiebreakerRow(tx, tiebreakerId);
  if (!tb || tb.status === 'dismissed') return null;
  const { winner, resolvedNow } = await settleWinner(tx, tb, pickWinner);
  await clearActiveTiebreaker(tx, tb.lineupId);
  const pass = (await needsDecide(tx, tb))
    ? await decideLineupInTx(tx, tb.lineupId, winner)
    : null;
  return { winner, lineupId: tb.lineupId, resolvedNow, pass };
}

/** After commit: cohort memory + poll-card events for the work THIS call did. */
async function announceFinalized(
  deps: TiebreakerDecideDeps,
  tiebreakerId: number,
  outcome: FinalizeOutcome,
): Promise<void> {
  const { winner, lineupId, resolvedNow, pass } = outcome;
  if (resolvedNow) {
    await writeTiebreakerCohortMemory(
      deps.db,
      lineupId,
      tiebreakerId,
      winner,
      deps.logger,
    );
  }
  if (pass) await announceLineupDecided(deps, lineupId, pass);
}

/** The stored winner of a resolved row, else pick one and resolve the row. */
async function settleWinner(
  tx: Db,
  tb: TiebreakerRow,
  pickWinner: WinnerPicker,
): Promise<{ winner: number; resolvedNow: boolean }> {
  if (tb.status === 'resolved' && tb.winnerGameId) {
    return { winner: tb.winnerGameId, resolvedNow: false };
  }
  const winner = await pickWinner(tb, tx);
  await markTiebreakerResolved(tx, tb.id, winner);
  return { winner, resolvedNow: true };
}

/**
 * True when the decided flip or the matching pass has not completed:
 * the lineup is still `voting`, or `decided` without a match group created
 * since this tiebreaker began.
 */
async function needsDecide(tx: Db, tb: TiebreakerRow): Promise<boolean> {
  const state = await findLineupDecideState(tx, tb.lineupId, tb.createdAt);
  if (!state) return false;
  if (state.status === 'voting') return true;
  return state.status === 'decided' && !state.hasMatches;
}
