// rl_claim — acquire a runner slot on the rl-infra fleet.
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_claim';
export const TOOL_DESCRIPTION =
  'Acquire a runner slot on the rl-infra fleet. Starts a Mutagen sync from the operator laptop to the runner worktree. Returns the slot number, runner container name, slot/debug hostnames, and the shell command to attach. Idempotent: if this agent already holds a slot, returns that one.';

export interface ClaimResult {
  ok: boolean;
  slot?: number;
  agent_id?: string;
  branch?: string;
  hostnames?: { web: string; debug: string };
  worktree?: string;
  container?: string;
  shell_cmd?: string;
  error?: string;
  message?: string;
}

export async function execute(params: { branch?: string }): Promise<ClaimResult> {
  const args = ['claim'];
  if (params.branch) args.push('--branch', params.branch);
  const { stdout, stderr, exitCode } = await runRl(args);
  const parsed = parseJsonFromStdout<ClaimResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl claim exited ${exitCode} with no parseable output`,
  };
}
