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
import {
  envForSlug,
  resolveInnerEnv,
  sanitizeBaseUrl,
  slugFromBaseUrl,
} from './validate-ci-target.js';
import * as task from './task.js';
import { resolveValidateCiWeight, weightFlag, type TaskWeight } from './task-weight.js';

// Re-exported so `rl_validate_ci`'s target helpers stay importable from this
// module (and its spec) after the ROK-1466 W1 split kept it under 300 lines.
export {
  envForSlug,
  resolveInnerEnv,
  sanitizeBaseUrl,
  slugFromBaseUrl,
} from './validate-ci-target.js';

export const TOOL_NAME = 'rl_validate_ci';
export const TOOL_DESCRIPTION =
  "Run the full validate-ci.sh pipeline (build, typecheck, lint, unit tests, integration tests, optional e2e) inside the agent's claimed runner — NOT on the operator's laptop. ASYNC BY DEFAULT (wait:false): returns {task_id, log_url, started_at} within 1s; poll via rl_task_status (cheap one-shot) or rl_task_wait (each call blocks ≤120s then returns a still_running progress snapshot — re-call with the SAME task_id to keep watching). Common args: --no-e2e (skip Playwright + Discord smoke), --only-e2e (only run them), --with-e2e (force-run). Booleans only_integration / only_unit / no_coverage forward --only-integration / --only-unit / --no-coverage: use only_integration when --full dies in the unit step on a memory-capped runner (it runs the sharded integration suite with the same Redis sidecar + shard count), and no_coverage to run jest/vitest without coverage at a 3 GB heap. ROK-1466: fleet:true forwards --fleet — the WHOLE gate in one dispatch (static steps + unit without coverage + sharded integration + e2e), replacing the old three-call dance; it REQUIRES a target, so pass base_url (any http(s) URL, e.g. http://rl-env-<slug>-allinone or https://slot-N.gamernight.net) or against_env_slug. base_url alone (without fleet) also works and exports BASE_URL + API_URL + HEALTH_URL so Playwright, global setup and the companion bot all drive the same host. A base_url of the form http://rl-env-<slug>-allinone re-seeds that env's admin@local password and threads it as ADMIN_PASSWORD automatically (same as against_env_slug); for ANY OTHER target (a slot subdomain, an external host) pass admin_password yourself or global setup logs in with the literal 'password' and 401s. Pass worktree_path if you claimed from a worktree. Pass against_env_slug to point Playwright + companion bot at a spun fleet env. wait:true blocks ≤120s inline (still_running on cap-expiry); it does NOT block longer — never use it as a walk-away call.";

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
  /** ROK-1467: forwards --only-integration (sharded integration suite only). */
  only_integration?: boolean;
  /** ROK-1467: forwards --only-unit (unit step only). */
  only_unit?: boolean;
  /** ROK-1467: forwards --no-coverage (jest/vitest without coverage, 3 GB heap). */
  no_coverage?: boolean;
  /**
   * ROK-1470 admission weight. Omitted → derived from the resolved args: every
   * mode that runs a suite (default/full, --only-unit, --only-integration,
   * --only-e2e, --with-e2e) is `heavy`; a --static-only run is `light`.
   */
  weight?: TaskWeight;
  /** ROK-1466: forwards --fleet — the whole gate in one dispatch. Needs a target. */
  fleet?: boolean;
  /** ROK-1466: explicit e2e target, exported as BASE_URL / API_URL / HEALTH_URL. */
  base_url?: string;
  /**
   * ROK-1466 W1: admin password for the target env. Only needed when the
   * target is NOT an `rl-env-<slug>-allinone` host (whose password this tool
   * re-seeds itself). Without it global setup logs in with the literal
   * 'password' and 401s.
   */
  admin_password?: string;
}

/**
 * Map the ROK-1467 boolean convenience params onto validate-ci.sh flags,
 * appended after any raw `args`. A flag already present in `args` is not
 * duplicated — the script would accept it twice, but a doubled flag in the
 * task log reads like a bug.
 */
export function resolveArgs(params: ValidateCiParams): string[] {
  const args = [...(params.args ?? [])];
  const flags: Array<[boolean | undefined, string]> = [
    [params.fleet, '--fleet'],
    [params.only_integration, '--only-integration'],
    [params.only_unit, '--only-unit'],
    [params.no_coverage, '--no-coverage'],
  ];
  for (const [enabled, flag] of flags) {
    if (enabled === true && !args.includes(flag)) args.push(flag);
  }
  return args;
}

export interface ValidateCiAsyncResult {
  ok: boolean;
  task_id?: string;
  log_url?: string;
  log_path?: string;
  started_at?: string;
  mcp_runtime_status?: string;
  slot?: number;
  /** ROK-1470 admission weight the run was dispatched with. */
  weight?: TaskWeight;
  error?: string;
  stderr?: string;
  message?: string;
}

const FLEET_DOMAIN = process.env.RL_FLEET_DOMAIN ?? 'fleet.gamernight.net';

/** 12-char task_id matching `[a-z0-9]{8,32}`. */
function newTaskId(): string {
  return randomBytes(6).toString('hex');
}

// ROK-1368: re-assert admin@local in the spun env to a KNOWN password and
// return it, so Playwright's global-setup (scripts/playwright-global-setup.ts,
// `ADMIN_PASSWORD || 'password'`) authenticates against the fleet env. env-spin
// seeds the env admin from RL_ADMIN_PASSWORD (or a random rl-<hex>) and only
// RETURNS the plaintext — it never persists it keyed by slug, so the harness
// can't look it up later. We re-seed via the rl-docker-proxy (the loopback-2375
// `docker exec` path rl_env_inspect already uses), preferring RL_ADMIN_PASSWORD
// so a tester's password stays stable, else a fresh rl-ci-<hex>. bootstrap-admin
// is idempotent (RESET_PASSWORD=true). Returns null on ANY failure — the caller
// then omits ADMIN_PASSWORD and global-setup keeps today's fallback behavior
// (fail-safe, never blocks the dispatch). slug is regex-gated [a-z0-9-]+ at the
// MCP boundary, so interpolation into the remote string is safe.
async function seedEnvAdminPassword(
  sshUser: string,
  sshHost: string,
  slug: string,
): Promise<string | null> {
  const container = `rl-env-${slug}-allinone`;
  const remote =
    `PW="$(grep -E '^RL_ADMIN_PASSWORD=' /srv/rl-infra/.env 2>/dev/null | head -1 | cut -d= -f2-)"; ` +
    `[ -z "$PW" ] && PW="rl-ci-$(openssl rand -hex 8)"; ` +
    `DOCKER_HOST=tcp://127.0.0.1:2375 docker exec ` +
    `-e ADMIN_PASSWORD="$PW" -e RESET_PASSWORD=true ${container} ` +
    `node /app/dist/scripts/bootstrap-admin.js >/dev/null 2>&1 && ` +
    `printf 'RL_SEEDED_PW=%s' "$PW"`;
  try {
    const { stdout } = await execFileP(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser}@${sshHost}`, remote],
      { maxBuffer: 1024 * 1024, timeout: 30_000 },
    );
    const m = stdout.match(/RL_SEEDED_PW=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
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
  const extraArgs = resolveArgs(params).map((a) => shellQuote(a)).join(' ');

  // Explicit base_url wins over the slug-derived hostname, so an agent can
  // point the gate at a slot subdomain (or any already-deployed env) without
  // owning the slug.
  let baseUrl: string | undefined;
  try {
    if (params.base_url) baseUrl = sanitizeBaseUrl(params.base_url);
  } catch (err) {
    return { ok: false, error: 'invalid_base_url', message: String(err) };
  }
  if (!baseUrl && params.against_env_slug) baseUrl = envForSlug(params.against_env_slug);

  // Fail at the MCP boundary rather than after a ~10s dispatch: --fleet with no
  // target exits 2 inside the runner, which the caller would only discover by
  // polling a task that was doomed before it started.
  if (params.fleet && !baseUrl) {
    return {
      ok: false,
      error: 'fleet_requires_base_url',
      message:
        'fleet:true needs a target — pass base_url (e.g. http://rl-env-<slug>-allinone) or against_env_slug.',
    };
  }

  // ROK-1368 + ROK-1466 W1: re-seed + thread the env's admin password so
  // Playwright global-setup authenticates (else it 401s on the literal
  // 'password'). An explicit admin_password wins; otherwise seed for whatever
  // slug we can name — `against_env_slug` OR one recovered from a base_url of
  // the form http://rl-env-<slug>-allinone, which is exactly what the
  // documented fleet:true flow passes.
  const seedSlug =
    params.against_env_slug ?? (baseUrl ? slugFromBaseUrl(baseUrl) : null);
  const adminPw =
    params.admin_password ??
    (seedSlug ? await seedEnvAdminPassword(sshUser, sshHost, seedSlug) : null);
  const innerEnv = resolveInnerEnv({ baseUrl, adminPassword: adminPw });
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
  // ROK-1470: heavy runs wait on host MemAvailable inside task-start before the
  // pipeline launches, which is what makes the over-subscribed 6g runner caps safe.
  const weight = resolveValidateCiWeight(resolveArgs(params), params.weight);
  const remote =
    `RL_AGENT_ID=${shellQuote(agentId)} ` +
    `/srv/rl-infra/orchestrator/bin/task-start ${shellQuote(taskId)} ` +
    `--tool rl_validate_ci ${slotFlag}${weightFlag(weight)}${timeoutFlag}` +
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
      weight,
    };
  }

  // wait:true — chain through ONE ≤120s executeWait. Returns terminal status OR
  // a still_running snapshot (ROK-1362); the caller re-polls to keep watching.
  return task.executeWait({ task_id: finalTaskId, timeout_seconds: waitTimeoutS });
}
