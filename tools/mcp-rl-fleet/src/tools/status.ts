// rl_status — global fleet state (slots, envs, host resources).
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_status';
export const TOOL_DESCRIPTION =
  'Snapshot the rl-infra fleet: per-slot claim state (busy/free, agent_id, branch, heartbeat), active envs (slug, slot, ttl, last_touched), host RAM/disk/load, live per-runner CPU/memory, and the wait queue (agents queued for a slot, with depth and head). Use this to check whether your slot is still valid, see what envs are spun, gauge queue pressure before claiming, or diagnose resource pressure before spinning a new env.';

// ROK-1338 PR-1 — runner sync-state fields.
// `last_sync_at` is the mtime of the newest file under the runner's worktree
// (proxy for Mutagen sync recency). `worktree_head` is the short SHA from
// `git rev-parse --short HEAD` inside the runner container. Both default to
// null when the slot isn't claimed (no worktree dir yet) — the orchestrator
// emits null, the TS schema accepts null OR absent gracefully.
export interface RunnerStat {
  container: string;
  cpu: string;
  mem: string;
  net: string;
  block: string;
  last_sync_at?: string | null;
  worktree_head?: string | null;
}

export interface StatusResult {
  ok: boolean;
  generated_at?: string;
  // ROK-1338 PR-1 — deployed orchestrator tree SHA. Surfaces what the VM is
  // actually running so agents can verify a freshly-merged change is live.
  // Optional + nullable: the operator's deploy script writes
  // /srv/rl-infra/.deployed_sha on every rsync; absent when not yet wired up.
  deployed_sha?: string | null;
  slots?: Array<{
    slot: number;
    claimed: boolean;
    agent_id: string | null;
    branch: string | null;
    started_at: string | null;
    last_heartbeat: string | null;
  }>;
  envs?: Array<{
    container: string;
    slug: string | null;
    slot: string | null;
    ttl: string | null;
    last_touched: string | null;
    status: string;
    created: string;
  }>;
  runners?: RunnerStat[];
  host?: { memory: string; disk: string; loadavg: string };
  queue?: Array<{ agent_id: string; branch: string | null; queued_at: string }>;
  queue_depth?: number;
  queue_head?: string | null;
  error?: string;
}

export async function execute(): Promise<StatusResult> {
  const { stdout, stderr, exitCode } = await runRl(['status']);
  const parsed = parseJsonFromStdout<StatusResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: stderr || stdout || `rl status exited ${exitCode}`,
  };
}
