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
 *   - decide: the lineup still in `voting`, or `decided` with no match group,
 *     needs the flip + matching pass; `decided` WITH a match group (or any
 *     later phase) is complete and is left alone.
 *
 * A second concurrent caller waits for the lock, finds the work done and
 * returns. A retry after a partial failure (clear / flip / matching failed
 * after the resolve committed) finds the missing step and completes it with
 * the stored winner. Neither earlier once-only guard did both: a conditional
 * resolve stranded the lineup in `voting`, a conditional decided flip stopped
 * a retry from re-running matching (which swallows its own errors).
 *
 * The steps deliberately use `deps.db`, NOT the lock's `tx`: each must commit
 * on its own so a failure leaves a repairable state, and the matching pass
 * must commit its match rows before the poll-card events it fires are
 * handled. The lock transaction only holds the advisory lock. Every waiter
 * on that lock takes it first, holding no row locks, so the outer-connection
 * work cannot deadlock against a waiter.
 */
import type * as schema from '../../drizzle/schema';
import { withTiebreakerAdvanceLock } from './tiebreaker-advance.helpers';
import {
  decideLineupFromTiebreaker,
  type TiebreakerDecideDeps,
} from './tiebreaker-decide.helpers';
import {
  clearActiveTiebreaker,
  resolveTiebreaker,
} from './tiebreaker-lifecycle.helpers';
import {
  findLineupDecideState,
  findTiebreakerById,
} from './tiebreaker-query.helpers';

type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;
type Db = TiebreakerDecideDeps['db'];

/** Picks the winner of a tiebreaker that has not been resolved yet. */
export type WinnerPicker = (tb: TiebreakerRow) => Promise<number>;

/**
 * Resolve (if needed), detach, and decide the lineup of a tiebreaker —
 * completing only the steps durable state says are missing.
 * @returns the winning game id, or null when the tiebreaker is gone or
 *   dismissed (nothing to finalize).
 */
export function finalizeTiebreaker(
  deps: TiebreakerDecideDeps,
  tiebreakerId: number,
  pickWinner: WinnerPicker,
): Promise<number | null> {
  return withTiebreakerAdvanceLock(deps.db, tiebreakerId, async () => {
    const [tb] = await findTiebreakerById(deps.db, tiebreakerId);
    if (!tb || tb.status === 'dismissed') return null;
    const winner = await settleWinner(deps.db, tb, pickWinner);
    await clearActiveTiebreaker(deps.db, tb.lineupId);
    if (await needsDecide(deps.db, tb.lineupId)) {
      await decideLineupFromTiebreaker(deps, tb.lineupId, winner);
    }
    return winner;
  });
}

/** The stored winner of a resolved row, else pick one and resolve the row. */
async function settleWinner(
  db: Db,
  tb: TiebreakerRow,
  pickWinner: WinnerPicker,
): Promise<number> {
  if (tb.status === 'resolved' && tb.winnerGameId) return tb.winnerGameId;
  const winner = await pickWinner(tb);
  await resolveTiebreaker(db, tb.id, winner);
  return winner;
}

/**
 * True when the decided flip or the matching pass has not completed:
 * the lineup is still `voting`, or `decided` without any match group.
 */
async function needsDecide(db: Db, lineupId: number): Promise<boolean> {
  const state = await findLineupDecideState(db, lineupId);
  if (!state) return false;
  if (state.status === 'voting') return true;
  return state.status === 'decided' && !state.hasMatches;
}
