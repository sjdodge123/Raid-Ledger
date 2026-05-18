// rl_validate_ci — run validate-ci.sh inside the agent's claimed runner.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const TOOL_NAME = 'rl_validate_ci';
export const TOOL_DESCRIPTION =
  "Run the full validate-ci.sh pipeline (build, typecheck, lint, unit tests, integration tests, optional e2e) inside the agent's claimed runner — NOT on the operator's laptop. Far faster than running locally because the runner has CPU/RAM headroom + warm node_modules cache. Returns full stdout, stderr, exit code. Common args: --no-e2e (skip Playwright + Discord smoke), --only-e2e (only run them), --with-e2e (force-run).";

export interface ValidateCiParams {
  /** Extra args to pass to validate-ci.sh (e.g. ["--no-e2e"], ["--only-e2e"]). */
  args?: string[];
  /** Soft timeout in seconds. Defaults to 1800 (30 min). */
  timeout_seconds?: number;
}

export interface ValidateCiResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}

export async function execute(params: ValidateCiParams): Promise<ValidateCiResult> {
  const timeoutMs = (params.timeout_seconds ?? 1800) * 1000;
  const sshUser = process.env.RL_PROXMOX_USER ?? 'rl-agent';
  const sshHost = process.env.RL_PROXMOX_HOST ?? 'rl-infra';
  const agentId =
    process.env.RL_AGENT_ID ?? `${process.env.USER ?? 'mcp'}-rl-fleet`;
  const extraArgs = (params.args ?? []).map((a) => JSON.stringify(a)).join(' ');

  const remote =
    `RL_AGENT_ID='${agentId}' /srv/rl-infra/orchestrator/bin/run-on-runner ` +
    `-- bash /workspace/scripts/validate-ci.sh ${extraArgs}`;

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
      { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
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
