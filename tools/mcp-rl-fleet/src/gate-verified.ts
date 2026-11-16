// ROK-2205 — the pre-push sentinel requires a gate_verified run.
//
// 2026-11-15: a `--full` gate (task 2e251bacf2a3) reported every row PASS while
// the runner was synced to an old main commit, and the sentinel was still
// written. Every PASS row then described OTHER code. This module names the
// conditions that veto a sentinel even when the summary rows are green.

import type { ExecuteStatusReturn } from './tools/task-schemas.js';

/** How the push hook's refusal and the tool reply name the fix. */
export const GATE_VERIFIED_FIX =
  'Re-run the gate (rl_validate_ci) and read the verified run with rl_task_status log_tail_bytes:3000.';

/** True when two shas (full or abbreviated) name the same commit. */
function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x.length > 0 && y.length > 0 && (x.startsWith(y) || y.startsWith(x));
}

const short = (sha: string): string => sha.trim().slice(0, 8);

/**
 * Why this terminal status must NOT earn a sentinel, or null when nothing
 * vetoes it. A missing `synced_head` is not a veto on its own: validate-ci
 * tasks do not report one today, and the tier checks still apply.
 *
 * @param status - A terminal validate-ci task status.
 * @param recordedSha - The worktree HEAD recorded for the task at dispatch.
 * @returns A human-readable reason, or null.
 */
export function gateVerifiedVeto(
  status: ExecuteStatusReturn,
  recordedSha: string,
): string | null {
  if (status.gate_verified === false) {
    return `The terminal result says gate_verified: false, so no sentinel was written. ${GATE_VERIFIED_FIX}`;
  }
  const synced = status.synced_head?.trim() ?? '';
  if (!synced) return null;
  const expected = status.expected_head?.trim() ?? '';
  const against = expected && !sameCommit(synced, expected) ? expected : recordedSha;
  if (sameCommit(synced, against)) return null;
  return (
    `Stale sync: the runner ran ${short(synced)} but the worktree HEAD for this task is ` +
    `${short(against)}, so its PASS rows describe other code and no sentinel was written. ` +
    `Run rl_force_resync, then: ${GATE_VERIFIED_FIX}`
  );
}
