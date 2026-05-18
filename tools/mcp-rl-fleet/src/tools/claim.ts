// rl_claim — acquire a runner slot on the rl-infra fleet.
//
// Two modes:
//   - default (wait=true): polls the queue until a slot is acquired or the
//     wait_timeout elapses. Returns the same shape as the single-shot call
//     when acquired, or a {queued, position, queue_length} response on
//     timeout.
//   - wait=false: single-shot call. Returns immediately with either a slot
//     or queued=true. Caller polls manually.

import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_claim';
export const TOOL_DESCRIPTION =
  "Acquire a runner slot on the rl-infra fleet. Starts a Mutagen sync from the operator laptop to the runner worktree. Returns the slot number, runner container name, slot/debug hostnames, and the shell command to attach. Idempotent: if this agent already holds a slot, returns that one. If all slots are busy, this agent is enqueued automatically — by default the tool then POLLS the queue (default 600s / 10min wait_timeout) until a slot frees or it times out. Pass wait=false for a single-shot call and handle polling yourself. CRITICAL when working in a git worktree: pass worktree_path with the absolute path to your worktree. Without it, the MCP server defaults to where Claude was started (usually the main repo) and Mutagen syncs the WRONG branch.";

export interface ClaimResult {
  ok: boolean;
  slot?: number;
  agent_id?: string;
  branch?: string;
  hostnames?: { web: string; debug: string };
  worktree?: string;
  container?: string;
  shell_cmd?: string;
  // Queue path:
  queued?: boolean;
  position?: number;
  queue_length?: number;
  // Polling-completed timeout path:
  wait_timed_out?: boolean;
  waited_seconds?: number;
  // Diagnostics:
  error?: string;
  message?: string;
}

export interface ClaimParams {
  branch?: string;
  /**
   * Absolute path to the agent's git worktree. The rl CLI runs
   * `git rev-parse --show-toplevel` from this cwd to determine which tree
   * to Mutagen-sync. REQUIRED when calling from a worktree — without it,
   * the MCP server uses its own cwd (where Claude started, usually the
   * main repo) and the sync grabs the WRONG branch's files.
   */
  worktree_path?: string;
  /** Default true — poll until acquired or wait_timeout_seconds elapses. */
  wait?: boolean;
  /** Default 600 (10 min). Min 5, max 3600. */
  wait_timeout_seconds?: number;
  /** Poll interval. Default 10s. Min 2, max 60. */
  poll_interval_seconds?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function singleClaim(branch?: string, cwd?: string): Promise<ClaimResult> {
  const args = ['claim'];
  if (branch) args.push('--branch', branch);
  const { stdout, stderr, exitCode } = await runRl(args, { cwd });
  const parsed = parseJsonFromStdout<ClaimResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl claim exited ${exitCode} with no parseable output`,
  };
}

export async function execute(params: ClaimParams): Promise<ClaimResult> {
  const wait = params.wait ?? true;
  const timeoutS = Math.max(5, Math.min(3600, params.wait_timeout_seconds ?? 600));
  const intervalS = Math.max(2, Math.min(60, params.poll_interval_seconds ?? 10));

  const first = await singleClaim(params.branch, params.worktree_path);
  if (!wait || !first.queued) return first;

  // Poll the queue. Each iteration re-calls `rl claim` — that's how the
  // queue advances: when a slot frees and we're at the head, the next claim
  // dequeues us atomically.
  const startedAt = Date.now();
  let last = first;
  while ((Date.now() - startedAt) / 1000 < timeoutS) {
    await sleep(intervalS * 1000);
    last = await singleClaim(params.branch, params.worktree_path);
    if (!last.queued) return last;
  }

  return {
    ...last,
    wait_timed_out: true,
    waited_seconds: Math.round((Date.now() - startedAt) / 1000),
    message: `Still queued after ${timeoutS}s. Position ${last.position ?? '?'} of ${last.queue_length ?? '?'}. Call rl_claim again to keep waiting, or rl_status to inspect the queue.`,
  };
}
