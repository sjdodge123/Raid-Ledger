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

/** A git sha of at least 7 hex chars — anything shorter names no one commit. */
const SHA_RE = /^[0-9a-f]{7,40}$/;

/** True when two shas (full or abbreviated, >= 7 hex chars) name the same commit. */
function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return SHA_RE.test(x) && SHA_RE.test(y) && (x.startsWith(y) || y.startsWith(x));
}

/**
 * ROK-2205 M1: the stale-build sync guard's verdict at rl_validate_ci dispatch,
 * stored next to the task's sha (`recordTaskSha`). `ok: false` means the guard
 * could not confirm the runner's /workspace matched the worktree HEAD.
 */
export interface GateSyncRecord {
  ok: boolean;
  expected_head: string | null;
  synced_head: string | null;
  /** Short reason when `ok` is false. */
  message?: string;
}

/** Veto from the dispatch-time sync record, or null. A missing record (a task
 *  dispatched by a server older than ROK-2205) is not a veto on its own. */
function syncRecordVeto(sync: GateSyncRecord | null, recordedSha: string): string | null {
  if (!sync) return null;
  if (!sync.ok) {
    return (
      `Stale sync: the sync guard could not confirm the runner's /workspace matched the ` +
      `worktree HEAD ${short(recordedSha)} at dispatch (${sync.message ?? 'unverified'}), so its ` +
      `PASS rows may describe other code and no sentinel was written. Run rl_force_resync, then: ${GATE_VERIFIED_FIX}`
    );
  }
  const synced = sync.synced_head?.trim() ?? '';
  if (!synced || sameCommit(synced, recordedSha)) return null;
  return (
    `Stale sync: the sync guard verified ${short(synced)} on the runner but this task covers ` +
    `${short(recordedSha)}, so no sentinel was written. Run rl_force_resync, then: ${GATE_VERIFIED_FIX}`
  );
}

const short = (sha: string): string => sha.trim().slice(0, 8);

/**
 * Why this terminal status must NOT earn a sentinel, or null when nothing
 * vetoes it. The main signal is `sync`, the sync guard's verdict recorded at
 * rl_validate_ci dispatch; a `synced_head` on the status itself is checked too.
 *
 * @param status - A terminal validate-ci task status.
 * @param recordedSha - The worktree HEAD recorded for the task at dispatch.
 * @param sync - The sync guard's dispatch-time verdict, when one was recorded.
 * @returns A human-readable reason, or null.
 */
export function gateVerifiedVeto(
  status: ExecuteStatusReturn,
  recordedSha: string,
  sync: GateSyncRecord | null = null,
): string | null {
  if (status.gate_verified === false) {
    return `The terminal result says gate_verified: false, so no sentinel was written. ${GATE_VERIFIED_FIX}`;
  }
  const fromSync = syncRecordVeto(sync, recordedSha);
  if (fromSync) return fromSync;
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
