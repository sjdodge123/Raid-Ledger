// ROK-1793 S2 — `parallel` on a parallel fleet gate parent's rl_task_status.
//
// gate-fanout records `parallel: {mode, borrowed_slot}` in P's JSON; an older
// orchestrator (or a P that died before writing it) is filled from children[]
// (a borrowed child = parallel) or P's `[parallel] fallback: serial` log line.

import type { ExecuteStatusReturn } from './task-schemas.js';

/** Log line gate-fanout prints after a successful merge. */
export const MERGED_MARKER = '[parallel] merged:';

/**
 * Add `parallel` to a status that lacks it but is evidently a parallel parent.
 *
 * @param status - A parsed task-status payload.
 * @returns The same status, with `parallel` filled when derivable.
 */
export function withParallelInfo<T extends ExecuteStatusReturn>(
  status: T,
): T & Pick<ExecuteStatusReturn, 'parallel'> {
  if (status.parallel) return status;
  const children = status.children ?? [];
  if (children.length > 0) {
    const borrowed = children.find((c) => c.borrowed);
    return { ...status, parallel: { mode: 'parallel', borrowed_slot: borrowed?.slot ?? null } };
  }
  if (status.log_tail?.includes('[parallel] fallback: serial')) {
    return { ...status, parallel: { mode: 'serial_fallback', borrowed_slot: null } };
  }
  return status;
}

/**
 * A parallel parent's verdict lives ONLY in the merged table. Before the merge
 * its log holds relayed raw `Name: PASS` child lines, which must never earn a
 * sentinel tier (a P killed mid-run would otherwise read as green).
 *
 * @param status - A terminal task status.
 * @returns true when this is a split parent with no merged table in its tail.
 */
export function parallelParentUnmerged(status: ExecuteStatusReturn): boolean {
  return isSplitParent(status) && !(status.log_tail ?? '').includes(MERGED_MARKER);
}

/**
 * Did this task fan out into children (as opposed to a serial run or fallback)?
 *
 * @param status - A task status.
 */
export function isSplitParent(status: ExecuteStatusReturn): boolean {
  return (status.children?.length ?? 0) > 0 || status.parallel?.mode === 'parallel';
}
