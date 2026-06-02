// ROK-1331 M5a — lease queue MCP tools.
//
// All five tools delegate to the rl CLI which SSHes to the rl-infra VM and
// invokes the matching orchestrator binary. The CLI's `printf-%q` escaping
// + the orchestrator's slug/timeout validation handles the H-VM-1 attack
// surface; this wrapper does Zod validation on the way IN to give the agent
// a clean error envelope before the SSH round-trip.

import { runRl, parseJsonFromStdout } from '../exec.js';

// ----- rl_lease_status -----
export const STATUS_TOOL = 'rl_lease_status';
export const STATUS_DESC =
  "Snapshot the lease state of one or all runner slots. Returns per-slot: current_holder, branch, expires_at, last_heartbeat, queue[] (FIFO array of {agent_id, branch, requested_at, preempt, last_heartbeat}), pinned_envs[] (slugs with sweeper-skip), claimable_envs[] ({slug, created_for_branch} marked by `release --preserve-envs`). Read-only — no flock — cheap to call. Omit `slot` to dump all slots; pass a specific slot number to filter. Unknown slot indices return slots:[] without erroring.";

export interface LeaseStatusParams {
  slot?: number;
}

export async function executeStatus(p: LeaseStatusParams = {}) {
  const args = ['lease-status'];
  if (typeof p.slot === 'number') args.push(String(p.slot));
  const { stdout, stderr, exitCode } = await runRl(args);
  const parsed = parseJsonFromStdout<unknown>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl lease-status exited ${exitCode} with no parseable output`,
  };
}

// ----- rl_claim_wait -----
export const WAIT_TOOL = 'rl_claim_wait';
export const WAIT_DESC =
  "Long-poll: block until this agent's queued claim is granted OR until the timeout expires (default 600s). Implemented via inotifywait on the lease-queue dir on the VM (push-like UX). On grant: returns the same shape as rl_claim ({slot, agent_id, branch, hostnames, expires_at, inherited_envs?, ...}). On timeout: returns the last-seen queued response with wait_timed_out:true + waited_seconds. Returns {ok:false, error:'inotifywait_not_installed'} if the runner image is missing inotify-tools. If you enqueued via rl_claim({slot:N}), pass the same slot here so the wait stays pinned to that slot. The CLI wraps this — agents can also spawn `rl claim-wait --timeout N` via Bash to get the harness's auto-background + task-notification on wake (mirrors rl test-plan wait).";

export interface ClaimWaitParams {
  timeout_seconds?: number;
  worktree_path?: string;
  /**
   * Pin the wait to a specific slot (1..N). MUST match the slot the agent
   * enqueued on via rl_claim({slot}) — forwarding it keeps every re-claim the
   * orchestrator performs pinned to that slot instead of grabbing whatever frees
   * first (which would strand the original queue entry and risk a double grant).
   */
  slot?: number;
}

export async function executeWait(p: ClaimWaitParams = {}) {
  const timeout = Math.max(5, Math.min(3600, p.timeout_seconds ?? 600));
  const args = ['claim-wait', '--timeout', String(timeout)];
  if (p.slot !== undefined) args.push('--slot', String(p.slot));
  const { stdout, stderr, exitCode } = await runRl(args, { cwd: p.worktree_path });
  const parsed = parseJsonFromStdout<unknown>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl claim-wait (queued) exited ${exitCode} with no parseable output`,
  };
}

// ----- rl_extend -----
export const EXTEND_TOOL = 'rl_extend';
export const EXTEND_DESC =
  "Extend the calling agent's claim. Pushes expires_at to NOW + hours*3600 (HARD SET — not additive on top of existing). Holder default behavior; operator (RL_PROXMOX_USER=rl in the MCP wrapper env, intentionally NOT exposed via this MCP path) can pass --slot to extend any claim. Hours must be 1..24; values outside the range return {ok:false, error:'hours_out_of_range'}. extends_count is bumped each call (cosmetic audit; no cap on recurrence).";

export interface ExtendParams {
  hours?: number;
  worktree_path?: string;
}

export async function executeExtend(p: ExtendParams = {}) {
  const hours = Math.max(1, Math.min(24, p.hours ?? 1));
  const args = ['extend', '--hours', String(hours)];
  const { stdout, stderr, exitCode } = await runRl(args, { cwd: p.worktree_path });
  const parsed = parseJsonFromStdout<unknown>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl extend exited ${exitCode} with no parseable output`,
  };
}

// ----- rl_env_pin / rl_env_unpin -----
export const PIN_TOOL = 'rl_env_pin';
export const PIN_DESC =
  "Pin an env to defeat the gc-sweeper's unhealthy-env reaper. Only the agent holding the env's slot's claim (or the operator) can pin. The 24h-idle ceiling still applies — pinned + last_touched > 24h ago is still reaped. Use when an env is intentionally paused / mid-debug and shouldn't be auto-cleaned. Returns {ok:true, slug, slot, pinned:true} on success, {ok:false, error:'slug_not_found'|'unauthorized'} on failure.";

export const UNPIN_TOOL = 'rl_env_unpin';
export const UNPIN_DESC =
  "Inverse of rl_env_pin — clear the pinned flag. Same authz (slot holder OR operator). After unpinning, the sweeper resumes its normal unhealthy-env reaper for the slug.";

export interface PinParams {
  slug: string;
  worktree_path?: string;
}

export async function executePin(p: PinParams) {
  const args = ['env', 'pin', p.slug];
  const { stdout, stderr, exitCode } = await runRl(args, { cwd: p.worktree_path });
  const parsed = parseJsonFromStdout<unknown>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl env pin exited ${exitCode} with no parseable output`,
  };
}

export async function executeUnpin(p: PinParams) {
  const args = ['env', 'unpin', p.slug];
  const { stdout, stderr, exitCode } = await runRl(args, { cwd: p.worktree_path });
  const parsed = parseJsonFromStdout<unknown>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl env unpin exited ${exitCode} with no parseable output`,
  };
}
