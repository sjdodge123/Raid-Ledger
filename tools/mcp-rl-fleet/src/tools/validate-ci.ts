// rl_validate_ci — run validate-ci.sh inside the agent's claimed runner.
//
// ROK-1331 M2 — default-async via M1's task-start primitive.
//   wait:false (default) → dispatch task, return {task_id, log_url, started_at}
//   wait:true            → dispatch task then chain to task.executeWait
//
// ROK-1362: executeWait now hard-caps each blocking wait at 120s. wait:true
// therefore returns either a terminal status (if the run finished within 120s)
// OR a still_running progress snapshot — the caller re-polls (rl_task_status /
// rl_task_wait) to keep watching. No path blocks the MCP channel beyond 120s.
//
// Bug C: the wrapped script is invoked via `bash <script>` so Mutagen's
// one-way-replica exec-bit stripping doesn't break execution.

import { randomBytes } from 'node:crypto';
import {
  deriveAgentId,
  getSshTarget,
  shellQuote,
  synthesizeEmptyStderrDiagnostic,
} from '../exec.js';
import { execFileP, ensureRunnerGit, resolveSlot } from './runner-git.js';
import * as task from './task.js';

export const TOOL_NAME = 'rl_validate_ci';
export const TOOL_DESCRIPTION =
  "Run the full validate-ci.sh pipeline (build, typecheck, lint, unit tests, integration tests, optional e2e) inside the agent's claimed runner — NOT on the operator's laptop. ASYNC BY DEFAULT (wait:false): returns {task_id, log_url, started_at} within 1s; poll via rl_task_status (cheap one-shot) or rl_task_wait (each call blocks ≤120s then returns a still_running progress snapshot — re-call with the SAME task_id to keep watching). Common args: --no-e2e (skip Playwright + Discord smoke), --only-e2e (only run them), --with-e2e (force-run). Pass worktree_path if you claimed from a worktree. Pass against_env_slug to point Playwright + companion bot at a spun fleet env. wait:true blocks ≤120s inline (still_running on cap-expiry); it does NOT block longer — never use it as a walk-away call.";

export interface ValidateCiParams {
  /** Extra args to pass to validate-ci.sh. */
  args?: string[];
  /** Same worktree_path used at rl_claim / rl_claim_wait time. */
  worktree_path?: string;
  /** Slug of a spun fleet env. e2e steps target http://rl-env-<slug>-allinone. */
  against_env_slug?: string;
  /** Soft timeout for the wrapped command. Defaults to 1800 (30 min). */
  timeout_seconds?: number;
  /** ROK-1331: default false (async). When true, chains to one ≤120s rl_task_wait. */
  wait?: boolean;
  /** Wait budget when wait:true. Capped at 120s (ROK-1362). */
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

/** 12-char task_id matching `[a-z0-9]{8,32}`. */
function newTaskId(): string {
  return randomBytes(6).toString('hex');
}

export async function execute(
  params: ValidateCiParams,
): Promise<ValidateCiAsyncResult | task.ExecuteWaitResult | task.StillRunningResult> {
  const { user: sshUser, host: sshHost } = await getSshTarget();
  const agentId = deriveAgentId(params.worktree_path);
  const wait = params.wait ?? false;
  const waitTimeoutS = params.wait_timeout_seconds ?? 120;

  // Defensive re-scaffold — non-fatal.
  await ensureRunnerGit(sshUser, sshHost, agentId, params.worktree_path).catch(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[rl_validate_ci] ensureRunnerGit failed (non-fatal): ${msg}`);
    },
  );

  const slot = await resolveSlot(sshUser, sshHost, agentId);

  // Build the inner command. Bug C: bash <script> instead of bare path.
  const extraArgs = (params.args ?? []).map((a) => shellQuote(a)).join(' ');
  let innerEnv = '';
  if (params.against_env_slug) {
    const slug = params.against_env_slug;
    innerEnv =
      `BASE_URL='http://rl-env-${slug}-allinone' ` +
      `API_URL='http://rl-env-${slug}-allinone/api' ` +
      `HEALTH_URL='http://rl-env-${slug}-allinone/api/health' `;
  }
  // Bug D: validate-ci.sh lives inside the runner container at /workspace —
  // task-start runs its target on the HOST, so route through
  // run-on-runner-with-heartbeat (docker exec + M5b progress lines).
  const innerCmd =
    `${innerEnv}bash /workspace/scripts/validate-ci.sh ${extraArgs}`.trim();
  const targetCmd =
    `/srv/rl-infra/orchestrator/bin/run-on-runner-with-heartbeat ` +
    `-- bash -c ${shellQuote(innerCmd)}`;

  const taskId = newTaskId();
  const slotFlag = slot !== null ? `--slot ${slot} ` : '';
  // Pass timeout_seconds through to task-start so the watchdog kills a hung run.
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
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser}@${sshHost}`, remote],
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
    return { ok: false, error: 'task_start_failed', stderr };
  }

  const finalTaskId = dispatch.task_id ?? taskId;
  const startedAt = dispatch.started_at ?? new Date().toISOString();
  const logUrl = `https://${FLEET_DOMAIN}/api/tasks/${finalTaskId}/log`;

  if (!wait) {
    return {
      ok: true,
      task_id: finalTaskId,
      log_url: logUrl,
      log_path: dispatch.log_path ?? `/srv/rl-infra/state/tasks/${finalTaskId}.log`,
      started_at: startedAt,
      mcp_runtime_status: 'running',
      slot: slot ?? undefined,
    };
  }

  // wait:true — chain through ONE ≤120s executeWait. Returns terminal status OR
  // a still_running snapshot (ROK-1362); the caller re-polls to keep watching.
  return task.executeWait({ task_id: finalTaskId, timeout_seconds: waitTimeoutS });
}
