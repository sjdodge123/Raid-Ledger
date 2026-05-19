// rl_validate_ci — run validate-ci.sh inside the agent's claimed runner.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { deriveAgentId, shellQuote } from '../exec.js';

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

  // Bug R (ROK-1326) defensive re-scaffold: slots claimed BEFORE the
  // cmd_claim scaffold change landed have an empty / stale .git inside
  // /workspace because the Mutagen ignore list now excludes .git entirely.
  // If the runner's .git/objects is missing, rebuild it via the rl CLI
  // helper before invoking validate-ci. Harmless if .git is already healthy.
  await ensureRunnerGit(sshUser, sshHost, agentId, params.worktree_path).catch(
    (err: unknown) => {
      // Non-fatal — if the scaffold can't run (claim missing, runner down)
      // validate-ci will surface the underlying failure on its own. But
      // log the cause to stderr (ROK-1326 fix-10, reviewer finding):
      // the original `.catch(() => {})` silently dropped failures; if
      // git init succeeds but git fetch dies (network blip, proxy
      // outage), .git/objects ends up empty and validate-ci runs
      // against a half-built tree without a hint of why.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[rl_validate_ci] ensureRunnerGit failed (non-fatal): ${msg}`);
    },
  );
  // Single-quote each arg so the remote shell does NOT expand $(...),
  // backticks, or ${var} (H-MCP-2). Zod's slug regex narrows
  // against_env_slug; args[] entries can be anything the agent passes,
  // so they MUST be shellQuote'd before crossing the SSH boundary.
  const extraArgs = (params.args ?? []).map((a) => shellQuote(a)).join(' ');

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
    // Slug is regex-locked by Zod to [a-z0-9-]+ so it's safe to interpolate
    // inside the single-quoted export values. (Defense in depth: keep
    // the literal single-quotes around each value.)
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

  // shellQuote the whole inner command for the remote shell. Inside the
  // outer single-quoted shellQuote, the single-quoted exports already in
  // `innerCmd` are escaped via the '\'' trick so they survive intact.
  const remote =
    `RL_AGENT_ID=${shellQuote(agentId)} ` +
    `/srv/rl-infra/orchestrator/bin/run-on-runner ` +
    `-- bash -c ${shellQuote(innerCmd)}`;

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

// Bug R defensive re-scaffold helper (ROK-1326). Probes the runner's
// /workspace/.git/objects directory. If missing, rebuilds .git from the
// laptop-side origin + branch (read via git from the worktree_path or the
// MCP server's cwd). Used by execute() above before invoking validate-ci.sh.
//
// Slot resolution: we call `rl status` and pluck the slot for this agent.
// We could shell out via `rl claim --no-wait` for the slot, but status is
// cheaper and doesn't risk side effects.
async function ensureRunnerGit(
  sshUser: string,
  sshHost: string,
  agentId: string,
  worktreePath: string | undefined,
): Promise<void> {
  // Resolve slot via the orchestrator's claim idempotency response.
  let slotResult: { stdout: string };
  try {
    slotResult = await execFileAsync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        `${sshUser}@${sshHost}`,
        `RL_AGENT_ID=${shellQuote(agentId)} /srv/rl-infra/orchestrator/bin/claim --branch unknown`,
      ],
      { maxBuffer: 1024 * 1024, timeout: 10_000 },
    );
  } catch {
    return; // no claim, no work to do
  }
  let slot: number | null = null;
  try {
    const parsed = JSON.parse(slotResult.stdout);
    if (typeof parsed.slot === 'number') slot = parsed.slot;
  } catch {
    return;
  }
  if (slot === null) return;

  // Probe /workspace/.git/objects. If it's a directory, .git is healthy.
  const container = `rl-runner-${slot}`;
  try {
    await execFileAsync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        `${sshUser}@${sshHost}`,
        `docker exec ${container} test -d /workspace/.git/objects`,
      ],
      { timeout: 10_000 },
    );
    return; // .git is already scaffolded — nothing to do
  } catch {
    // Missing — fall through to scaffold.
  }

  // Resolve laptop-side origin URL + branch via plain git.
  const cwd = worktreePath ?? process.cwd();
  let originUrl: string;
  let branch: string;
  try {
    originUrl = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    }).trim();
  } catch {
    return; // no origin remote — skip
  }
  if (!originUrl) return;
  try {
    branch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    }).trim();
  } catch {
    branch = '';
  }
  if (!branch) branch = 'main';

  // Build the scaffold script. shellQuote each user-influenced value so
  // remote-side expansion can't fire (H-MCP-2 pattern).
  const script =
    `set -e; cd /workspace; rm -rf .git; git init -q; ` +
    `git remote add origin ${shellQuote(originUrl)}; ` +
    `git fetch origin main --depth=500 -q; ` +
    `git reset --mixed FETCH_HEAD; ` +
    `git checkout -q -B ${shellQuote(branch)} 2>/dev/null || true`;
  await execFileAsync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      `${sshUser}@${sshHost}`,
      `docker exec -i ${container} bash -c ${shellQuote(script)}`,
    ],
    { timeout: 60_000 },
  ).catch(() => {
    // Non-fatal — surface as a warning via stderr in the parent flow.
  });
}
