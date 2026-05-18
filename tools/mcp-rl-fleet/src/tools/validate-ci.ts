// rl_validate_ci — run validate-ci.sh inside the agent's claimed runner.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deriveAgentId } from '../exec.js';

const execFileAsync = promisify(execFile);

export const TOOL_NAME = 'rl_validate_ci';
export const TOOL_DESCRIPTION =
  "Run the full validate-ci.sh pipeline (build, typecheck, lint, unit tests, integration tests, optional e2e) inside the agent's claimed runner — NOT on the operator's laptop. Far faster than running locally because the runner has CPU/RAM headroom + warm node_modules cache. Returns full stdout, stderr, exit code. Common args: --no-e2e (skip Playwright + Discord smoke), --only-e2e (only run them), --with-e2e (force-run). Pass worktree_path if you claimed from a worktree. Pass against_env_slug to point Playwright + companion bot at a spun fleet env (http://rl-env-<slug>-allinone via the runner's rl-net), so e2e tests run against the deployed allinone instead of expecting localhost:3000/:5173 inside the runner.";

export interface ValidateCiParams {
  /** Extra args to pass to validate-ci.sh (e.g. ["--no-e2e"], ["--only-e2e"]). */
  args?: string[];
  /** Same worktree_path used at rl_claim time. */
  worktree_path?: string;
  /**
   * Slug of a spun fleet env (from rl_env_spin / rl_env_deploy). When set,
   * the e2e step targets http://rl-env-<slug>-allinone (the runner reaches
   * it directly via rl-net Docker DNS) instead of localhost. Required for
   * Playwright + companion-bot smoke in fleet mode — otherwise those steps
   * try to hit localhost inside the runner where nothing is listening.
   */
  against_env_slug?: string;
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
  const agentId = deriveAgentId(params.worktree_path);
  const extraArgs = (params.args ?? []).map((a) => JSON.stringify(a)).join(' ');

  // When targeting a spun fleet env, set BASE_URL (Playwright), API_URL
  // (companion bot), and HEALTH_URL (validate-ci's check_env_up probe) so
  // every e2e tool inside the runner hits the env's allinone rather than
  // localhost. The runner is on rl-net, so the env container resolves by
  // its Docker DNS name without going through Cloudflare/Traefik.
  //
  // The env vars must be set INSIDE the runner container — docker exec only
  // inherits explicit -e flags. So we wrap validate-ci.sh in a bash -c that
  // exports the vars first, before invoking the script. RL_AGENT_ID stays at
  // the orchestrator level (run-on-runner reads it on the VM to find the slot).
  const innerEnv: string[] = [];
  if (params.against_env_slug) {
    const slug = params.against_env_slug;
    // App URL: nginx in allinone serves React at / and proxies /api/* to backend.
    // Playwright navigates here for UI flows.
    innerEnv.push(`export BASE_URL='http://rl-env-${slug}-allinone'`);
    // API URL: companion bot hits /admin/test/* endpoints. Behind /api in
    // the allinone topology (vs local-dev where API is on :3000 bare).
    innerEnv.push(`export API_URL='http://rl-env-${slug}-allinone/api'`);
    // Health probe goes through nginx's /api proxy.
    innerEnv.push(
      `export HEALTH_URL='http://rl-env-${slug}-allinone/api/health'`,
    );
  }
  const innerCmd =
    innerEnv.length > 0
      ? `${innerEnv.join('; ')}; /workspace/scripts/validate-ci.sh ${extraArgs}`
      : `/workspace/scripts/validate-ci.sh ${extraArgs}`;

  const remote =
    `RL_AGENT_ID='${agentId}' /srv/rl-infra/orchestrator/bin/run-on-runner ` +
    `-- bash -c ${JSON.stringify(innerCmd)}`;

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
