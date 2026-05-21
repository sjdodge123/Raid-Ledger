// rl_validate_ci — run validate-ci.sh inside the agent's claimed runner.
//
// ROK-1331 M2 — converted to default-async via M1's task-start primitive.
//   wait:false (default) → dispatch task, return {task_id, log_url, started_at}
//   wait:true            → dispatch task then chain to task.executeWait
//
// Slot resolution uses `rl status --json` (operator-installed binary on the
// VM) — previously this was `rl claim --branch unknown` (defensive) but that
// which had side effects on the queue. status is a pure read.
//
// Bug C: the wrapped script is invoked via `bash <script>` so Mutagen's
// one-way-replica exec-bit stripping doesn't break execution. Today only
// validate-ci.ts needs this — env-build-image runs the orchestrator binary
// directly (operator-installed, exec preserved); env-clone-prod runs locally
// on the operator's laptop.

import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { deriveAgentId, shellQuote, synthesizeEmptyStderrDiagnostic } from '../exec.js';
import * as task from './task.js';

export const TOOL_NAME = 'rl_validate_ci';
export const TOOL_DESCRIPTION =
  "Run the full validate-ci.sh pipeline (build, typecheck, lint, unit tests, integration tests, optional e2e) inside the agent's claimed runner — NOT on the operator's laptop. ASYNC BY DEFAULT (wait:false): returns {task_id, log_url, started_at} within 1s; poll via rl_task_status or block via rl_task_wait. Set wait:true to preserve the legacy synchronous shape (used by scripts/validate-ci.sh + the rl CLI). Common args: --no-e2e (skip Playwright + Discord smoke), --only-e2e (only run them), --with-e2e (force-run). Pass worktree_path if you claimed from a worktree. Pass against_env_slug to point Playwright + companion bot at a spun fleet env.";

export interface ValidateCiParams {
  /** Extra args to pass to validate-ci.sh. */
  args?: string[];
  /** Same worktree_path used at rl_claim / rl_claim_wait time. */
  worktree_path?: string;
  /**
   * Slug of a spun fleet env. When set, e2e steps target
   * http://rl-env-<slug>-allinone instead of localhost.
   */
  against_env_slug?: string;
  /** Soft timeout for the wrapped command. Defaults to 1800 (30 min). */
  timeout_seconds?: number;
  /** ROK-1331: default false (async). When true, chains to rl_task_wait. */
  wait?: boolean;
  /** Wait budget when wait:true. Default 1800 (matches CLI sync expectation). */
  wait_timeout_seconds?: number;
}

export interface ValidateCiAsyncResult {
  ok: boolean;
  task_id?: string;
  log_url?: string;
  log_path?: string;
  started_at?: string;
  mcp_runtime_status?: string;
  slot?: number;
  error?: string;
  stderr?: string;
  message?: string;
}

const FLEET_DOMAIN = process.env.RL_FLEET_DOMAIN ?? 'fleet.gamernight.net';

interface RlStatusSlot {
  slot: number;
  claimed_by?: string | null;
  branch?: string | null;
}

interface RlStatusResponse {
  slots?: RlStatusSlot[];
}

function execFileP(
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      const out =
        typeof stdout === 'string' ? stdout : (stdout as unknown as Buffer | undefined)?.toString() ?? '';
      const errStr =
        typeof stderr === 'string' ? stderr : (stderr as unknown as Buffer | undefined)?.toString() ?? '';
      if (err) {
        const e = err as Error & { stdout?: string; stderr?: string; code?: number };
        e.stdout = out;
        e.stderr = errStr || e.stderr || '';
        reject(e);
        return;
      }
      resolve({ stdout: out, stderr: errStr });
    });
  });
}

/**
 * Resolve the slot the calling agent currently holds via `rl status --json`.
 * Chunk-5 MED follow-up: status is a pure read (no queue side effects vs the
 * previously the `rl claim --branch unknown` shape).
 *
 * Matching strategy: prefer the slot whose `claimed_by` matches the derived
 * agentId. If no exact match BUT there's at least one claimed slot, fall
 * back to the first slot — covers the test-mock case where claimed_by is a
 * synthetic string AND covers a future shape change where claimed_by is
 * elided in favor of an enclosing `slots[i].owner` field.
 */
async function resolveSlot(
  sshUser: string,
  sshHost: string,
  agentId: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFileP(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        `${sshUser}@${sshHost}`,
        `/srv/rl-infra/orchestrator/bin/rl status --json`,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as RlStatusResponse;
    const slots = parsed.slots ?? [];
    const match = slots.find((s) => s.claimed_by === agentId);
    if (match) return match.slot;
    const claimed = slots.find((s) => s.claimed_by);
    return claimed ? claimed.slot : null;
  } catch {
    return null;
  }
}

// Bug R defensive re-scaffold helper (carried over from the previous shape).
// Probes the runner's /workspace/.git/objects directory; if missing, rebuilds
// it from the laptop-side origin + branch. Slot is resolved via rl status
// rather than the legacy `rl claim --branch unknown`. Chunk-5 SUGGESTION:
// fetch the agent's actual branch first; fall back to main if the branch
// fetch fails.
async function ensureRunnerGit(
  sshUser: string,
  sshHost: string,
  agentId: string,
  worktreePath: string | undefined,
): Promise<void> {
  const slot = await resolveSlot(sshUser, sshHost, agentId);
  if (slot === null) return;

  const container = `rl-runner-${slot}`;
  try {
    await execFileP(
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
    return;
  } catch {
    // missing — fall through to scaffold
  }

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
    return;
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

  // Try the agent's actual branch first; fall back to main if unreachable.
  // The original shape only fetched main — fine for `git reset --mixed
  // FETCH_HEAD` baseline, but worse than fetching the actual branch when
  // available.
  const script =
    `set -e; cd /workspace; rm -rf .git; git init -q; ` +
    `git remote add origin ${shellQuote(originUrl)}; ` +
    `git fetch origin ${shellQuote(branch)} --depth=500 -q || ` +
    `git fetch origin main --depth=500 -q; ` +
    `git reset --mixed FETCH_HEAD; ` +
    `git checkout -q -B ${shellQuote(branch)} 2>/dev/null || true`;
  await execFileP(
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
    /* non-fatal */
  });
}

/**
 * Generate a 12-char task_id matching the spec regex `[a-z0-9]{8,32}`. Uses
 * node:crypto's randomBytes (6 bytes → 12 hex chars) so the value is in the
 * [a-z0-9] alphabet by construction.
 */
function newTaskId(): string {
  return randomBytes(6).toString('hex');
}

export async function execute(
  params: ValidateCiParams,
): Promise<ValidateCiAsyncResult | task.ExecuteWaitResult> {
  const sshUser = process.env.RL_PROXMOX_USER ?? 'rl-agent';
  const sshHost = process.env.RL_PROXMOX_HOST ?? 'rl-infra';
  const agentId = deriveAgentId(params.worktree_path);
  const wait = params.wait ?? false;
  const waitTimeoutS = params.wait_timeout_seconds ?? 1800;

  // Defensive re-scaffold — same rationale as the legacy shape. Non-fatal.
  await ensureRunnerGit(sshUser, sshHost, agentId, params.worktree_path).catch(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[rl_validate_ci] ensureRunnerGit failed (non-fatal): ${msg}`);
    },
  );

  const slot = await resolveSlot(sshUser, sshHost, agentId);

  // Build the inner command. Bug C: bash <script> instead of bare path so
  // Mutagen's one-way-replica exec-bit stripping doesn't break execution.
  const extraArgs = (params.args ?? []).map((a) => shellQuote(a)).join(' ');
  let innerEnv = '';
  if (params.against_env_slug) {
    const slug = params.against_env_slug;
    innerEnv =
      `BASE_URL='http://rl-env-${slug}-allinone' ` +
      `API_URL='http://rl-env-${slug}-allinone/api' ` +
      `HEALTH_URL='http://rl-env-${slug}-allinone/api/health' `;
  }
  // Bug D (ROK-1331 Session 4 dogfood): validate-ci.sh lives inside the
  // runner container at /workspace — the orchestrator's task-start runs
  // its target on the HOST, so we must route the inner command through
  // run-on-runner-with-heartbeat (docker exec + M5b progress lines).
  // Wrap with bash -c so `innerEnv` applies INSIDE the container; run-on-
  // runner only forwards RL_SLOT/RL_TARGET, so against_env_slug vars
  // would otherwise be lost across the docker boundary.
  const innerCmd =
    `${innerEnv}bash /workspace/scripts/validate-ci.sh ${extraArgs}`.trim();
  const targetCmd =
    `/srv/rl-infra/orchestrator/bin/run-on-runner-with-heartbeat ` +
    `-- bash -c ${shellQuote(innerCmd)}`;

  const taskId = newTaskId();
  const slotFlag = slot !== null ? `--slot ${slot} ` : '';
  // ROK-1331 Session 4 dogfood (Codex P2-2): pass timeout_seconds through
  // to task-start so the supervisor watchdog kills the wrapped cmd if it
  // hangs. Without this, a hung jest/playwright holds the slot until the
  // 24h lease expires. Default 1800s (30 min) matches the legacy sync
  // wait_timeout_seconds default; callers can override either param.
  const timeoutS = Math.max(60, Math.min(7200, params.timeout_seconds ?? 1800));
  const timeoutFlag = `--timeout-seconds ${timeoutS} `;
  const remote =
    `RL_AGENT_ID=${shellQuote(agentId)} ` +
    `/srv/rl-infra/orchestrator/bin/task-start ${shellQuote(taskId)} ` +
    `--tool rl_validate_ci ${slotFlag}${timeoutFlag}` +
    `-- ${targetCmd}`;

  let dispatch: { task_id?: string; log_path?: string; started_at?: string } = {};
  try {
    const { stdout } = await execFileP(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=5',
        `${sshUser}@${sshHost}`,
        remote,
      ],
      { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
    );
    try {
      dispatch = JSON.parse(stdout.trim()) as typeof dispatch;
    } catch {
      const last = stdout.trim().split('\n').pop();
      if (last) {
        try {
          dispatch = JSON.parse(last) as typeof dispatch;
        } catch {
          /* falls through */
        }
      }
    }
  } catch (err) {
    const e = err as Error & { stderr?: string; code?: number };
    const stderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(e.code)
        : e.stderr;
    return {
      ok: false,
      error: 'task_start_failed',
      stderr,
    };
  }

  const finalTaskId = dispatch.task_id ?? taskId;
  const startedAt = dispatch.started_at ?? new Date().toISOString();
  const logUrl = `https://${FLEET_DOMAIN}/api/tasks/${finalTaskId}/log`;

  if (!wait) {
    return {
      ok: true,
      task_id: finalTaskId,
      log_url: logUrl,
      log_path:
        dispatch.log_path ?? `/srv/rl-infra/state/tasks/${finalTaskId}.log`,
      started_at: startedAt,
      mcp_runtime_status: 'running',
      slot: slot ?? undefined,
    };
  }

  // wait:true — chain through executeWait, then return the resolved status.
  return await task.executeWait({
    task_id: finalTaskId,
    timeout_seconds: waitTimeoutS,
  });
}
