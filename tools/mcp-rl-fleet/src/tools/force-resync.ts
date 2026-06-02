// rl_force_resync — force-recreate a WEDGED Mutagen sync for the agent's slot.
//
// Recovery primitive for the stale-build hazard (TECH-DEBT 2026-06-02): a
// Mutagen one-way-replica session that halted after rapid history-rewriting
// rebases (or a duplicate-session race) keeps /workspace frozen on old source,
// so redeploys silently build pre-change code. `rl_env_deploy` auto-runs this
// when its pre-build sync guard detects staleness; expose it standalone so an
// agent (or operator) can recover a wedged sync WITHOUT a full release/reclaim.
//
// Unlike rl_force_release this stays in the normal rl-agent identity — it only
// terminates + recreates the caller's OWN sync session and re-scaffolds the
// runner .git. It never touches another agent's slot.

import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_force_resync';
export const TOOL_DESCRIPTION =
  "Force-recreate the Mutagen sync session for the slot you currently hold: terminate it, recreate it from scratch, flush until in-sync, and re-scaffold the runner-side .git. Use to recover a WEDGED sync — the symptom is a redeploy that keeps serving OLD code, or rl_status showing the runner's worktree_head / synced files behind your laptop branch HEAD, typically after a rapid sequence of local rebases in the synced worktree. Requires an active claim (rl_claim, or rl_claim_wait if you were enqueued, first). Pass worktree_path with the same value you used at claim time when working from a git worktree. Does NOT release the slot. This is the documented force-resync path; rl_env_deploy also runs it automatically when its pre-build sync guard trips.";

export interface ForceResyncParams {
  /** Same worktree_path used at rl_claim / rl_claim_wait time. Required for worktree-based agents. */
  worktree_path?: string;
}

export interface ForceResyncResult {
  ok: boolean;
  slot?: number;
  branch?: string;
  resynced?: boolean;
  error?: string;
  message?: string;
}

export async function execute(params: ForceResyncParams): Promise<ForceResyncResult> {
  // Bound the child process so a stuck Mutagen flush on the VM can't pin the
  // tool indefinitely (Codex review 2026-06-02, med).
  const { stdout, stderr, exitCode } = await runRl(['resync'], {
    cwd: params.worktree_path,
    timeoutMs: 180_000,
  });
  const parsed = parseJsonFromStdout<ForceResyncResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'resync_failed',
    message:
      stderr ||
      stdout ||
      `rl resync exited ${exitCode} with no parseable output (no active claim? run rl_claim, or rl_claim_wait if enqueued, first).`,
  };
}
