// rl_run_on_runner — execute a shell command inside the agent's claimed runner.
//
// Bypasses the rl CLI dispatch (which doesn't expose run-on-runner as a
// subcommand) and ssh's directly into the VM to invoke the orchestrator's
// run-on-runner script. Forces agent identity.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deriveAgentId } from '../exec.js';

const execFileAsync = promisify(execFile);

export const TOOL_NAME = 'rl_run_on_runner';
export const TOOL_DESCRIPTION =
  "Run a shell command inside the agent's claimed runner container. Use this for `npm test`, `npm run build`, `jest <spec>`, `npx playwright test`, or anything else that needs to execute against the Mutagen-synced /workspace. Captures stdout, stderr, and exit code. Requires a slot to be claimed first (call rl_claim). Pass worktree_path if you claimed from a worktree — must match the value used at claim time.";

export interface RunOnRunnerParams {
  /** Shell command to run inside the runner container (executed in /workspace). */
  command: string;
  /** Same worktree_path used at rl_claim time. Required for worktree-based agents. */
  worktree_path?: string;
  /** Soft timeout in seconds. Defaults to 300 (5 min). */
  timeout_seconds?: number;
}

export interface RunOnRunnerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}

export async function execute(params: RunOnRunnerParams): Promise<RunOnRunnerResult> {
  const timeoutMs = (params.timeout_seconds ?? 300) * 1000;
  const sshUser = process.env.RL_PROXMOX_USER ?? 'rl-agent';
  const sshHost = process.env.RL_PROXMOX_HOST ?? 'rl-infra';
  // Match the rl CLI's auto-derived agent id, so the slot claimed via
  // rl_claim is the same slot run-on-runner targets.
  const agentId = deriveAgentId(params.worktree_path);

  // The orchestrator's run-on-runner takes `-- <cmd> [args...]`. We pass
  // `bash -c <user-command>` so multi-token commands work as one argument.
  const remote =
    `RL_AGENT_ID='${agentId}' /srv/rl-infra/orchestrator/bin/run-on-runner ` +
    `-- bash -c ${JSON.stringify(params.command)}`;

  try {
    const result = await execFileAsync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        `${sshUser}@${sshHost}`,
        remote,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs },
    );
    return { ok: true, stdout: result.stdout, stderr: result.stderr, exit_code: 0 };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      exit_code: e.code ?? 1,
    };
  }
}
