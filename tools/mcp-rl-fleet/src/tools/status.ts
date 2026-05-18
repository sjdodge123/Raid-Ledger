// rl_status — global fleet state (slots, envs, host resources).
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_status';
export const TOOL_DESCRIPTION =
  'Snapshot the rl-infra fleet: per-slot claim state (busy/free, agent_id, branch, heartbeat), active envs (slug, slot, ttl, last_touched), host RAM/disk/load, and live per-runner CPU/memory. Use this to check whether your slot is still valid, see what envs are spun, or diagnose resource pressure before spinning a new env.';

export interface StatusResult {
  ok: boolean;
  generated_at?: string;
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
  runners?: Array<{ container: string; cpu: string; mem: string; net: string; block: string }>;
  host?: { memory: string; disk: string; loadavg: string };
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
