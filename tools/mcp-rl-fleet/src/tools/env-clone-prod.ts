// rl_env_clone_prod — refresh operator's local DB from prod, then push to env.
//
// ROK-1362: now ASYNC by default. The clone runs on the OPERATOR LAPTOP (not the
// VM — task-start doesn't apply), so it dispatches a detached LAPTOP task
// (`local-<id>`) via the laptop task registry and returns {task_id} in ~1s. Poll
// rl_task_status / rl_task_wait (each wait caps at 120s) — uniform with the VM
// task surface. The synchronous chain body lives in runCloneCore so the
// rl_env_deploy chain (step 6) can call it inline inside its own runner.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { VM_DOCKER_HOST } from '../docker-proxy.js';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildSshArgs } from '../exec.js';
import { newLocalTaskId, spawnLocalRunner, waitLocalTask } from '../local-task.js';
import type { ExecuteStatusReturn, StillRunningResult } from './task-schemas.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
/** The clone script of whichever tree the MCP server loaded from — the fallback
 *  when no worktree_path is given (often the MAIN checkout, possibly stale). */
export const CLONE_SCRIPT = resolve(__dirname, '../../../../scripts/clone-prod-to-env.sh');

/**
 * ROK-2263 D15: the caller's worktree runs its OWN clone scripts (a stale main
 * checkout's copy predates the DB-direct restore). Falls back to CLONE_SCRIPT
 * when no worktree_path is given or that tree has no clone-prod-to-env.sh.
 */
export function resolveCloneScript(worktreePath: string | undefined): string {
  if (worktreePath) {
    const candidate = resolve(worktreePath, 'scripts/clone-prod-to-env.sh');
    if (existsSync(candidate)) return candidate;
  }
  return CLONE_SCRIPT;
}

/** Script args: slug, the optional skip flag, then `--tree <worktree_path>`. */
export function buildCloneArgs(params: EnvCloneProdParams): string[] {
  const args = [params.slug];
  if (params.skip_local_refresh) args.push('--skip-local-refresh');
  if (params.worktree_path) args.push('--tree', resolve(params.worktree_path));
  return args;
}

export const TOOL_NAME = 'rl_env_clone_prod';
export const TOOL_DESCRIPTION =
  "Clone production data into a test env. Three-step: (1) refreshes the operator's local DB from prod via clone-prod-to-local.sh (sanitized backup; app_settings preserved), (2) applies the tree's migrations to that clone (npm run db:migrate -w api, so branch schema AND data migrations run on the prod rows), (3) pushes that snapshot into the test env via rl_env_sync_from_local in `full` mode. Pass `worktree_path` (absolute path of your worktree, like every slot tool): the clone then runs THAT tree's scripts/clone-prod-to-env.sh with `--tree <worktree_path>` (falls back to the MCP server's own checkout when absent). Auth comes from a clone env file — lookup order $RL_ENV_CLONE_FILE → ~/.config/raid-ledger/env.clone → <tree>/.env.clone → main checkout .env.clone — holding PROD_URL, DATABASE_URL and PROD_BACKUP_TOKEN (rlbx_…). The restore goes straight into the local DB container (no local API needed) and keeps prod's migration journal. To measure a branch migration on prod-shaped data WITHOUT touching the local DB, run scripts/clone-prod-measure-migration.sh instead (scratch DB, BEGIN…ROLLBACK). The destructive `--fresh` flag is used implicitly — operator's LOCAL DB gets overwritten by prod data. Set skip_local_refresh=true to skip the prod→local step if you've recently cloned (faster). ASYNC (ROK-1362): runs as a detached LAPTOP task — returns {ok:true, task_id:'local-...', started_at} in ~1s. Poll rl_task_status local-... or rl_task_wait (each call caps at 120s and returns a still_running progress snapshot until the clone finishes). Do NOT block on a single long wait.";

export interface EnvCloneProdParams {
  slug: string;
  /** ROK-2263 D15: absolute path of the caller's worktree — its scripts run, with `--tree`. */
  worktree_path?: string | undefined;
  /** Skip the prod→local refresh step. Use after a recent clone-prod-to-local. */
  skip_local_refresh?: boolean | undefined;
  /** Soft timeout. Defaults to 1200 (20 min) — prod backup + download + restore can be slow. */
  timeout_seconds?: number | undefined;
  /** ROK-1362: wait:true blocks (≤120s) on the laptop task then returns the
   *  terminal status OR a still_running snapshot. Default false (returns task_id). */
  wait?: boolean | undefined;
  /** Wait budget when wait:true. Capped at 120s. */
  wait_timeout_seconds?: number | undefined;
}

export interface EnvCloneProdResult {
  ok: boolean;
  slug: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  /** Whether the allinone was restarted after the clone to refresh SettingsService cache. */
  restarted_for_settings?: boolean | undefined;
  restart_error?: string | undefined;
}

export interface EnvCloneProdDispatch {
  ok: boolean;
  task_id?: string;
  started_at?: string;
  message?: string;
  error?: string;
}

/**
 * The synchronous clone chain. Runs inside the laptop runner (env-clone-prod's
 * own task OR the rl_env_deploy step-6 runner). Refreshes local DB from prod →
 * pushes to env → restarts the allinone to refresh SettingsService cache.
 */
export async function runCloneCore(params: EnvCloneProdParams): Promise<EnvCloneProdResult> {
  const timeoutMs = (params.timeout_seconds ?? 1200) * 1000;
  const args = buildCloneArgs(params);
  let cloneResult: { stdout: string; stderr: string };
  try {
    cloneResult = await execFileAsync(resolveCloneScript(params.worktree_path), args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env },
    });
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      slug: params.slug,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      exit_code: e.code ?? 1,
    };
  }

  // Restart allinone so SettingsService re-reads + re-caches the new
  // app_settings rows. Without this, the 30-min boot cache holds the
  // pre-clone state and integrations look broken until TTL.
  let restartedForSettings = false;
  let restartError: string | undefined;
  try {
    const sshArgs = await buildSshArgs(
      // DOCKER_HOST→wollomatic proxy (rl-agent has no docker group; Bug G).
      `DOCKER_HOST=${VM_DOCKER_HOST} docker restart rl-env-${params.slug}-allinone && sleep 6`,
    );
    await execFileAsync('ssh', sshArgs, { timeout: 60_000 });
    restartedForSettings = true;
  } catch (err) {
    const e = err as Error & { stderr?: string };
    restartError = e.stderr || e.message;
  }

  return {
    ok: true,
    slug: params.slug,
    stdout: cloneResult.stdout,
    stderr: cloneResult.stderr,
    exit_code: 0,
    restarted_for_settings: restartedForSettings,
    restart_error: restartError,
  };
}

/**
 * Async dispatch: spawn a detached laptop runner that executes runCloneCore and
 * streams progress into ~/.raid-ledger/tasks/local-...json. Returns a task_id.
 */
export async function execute(
  params: EnvCloneProdParams,
): Promise<EnvCloneProdDispatch | ExecuteStatusReturn | StillRunningResult> {
  const taskId = newLocalTaskId();
  const { started_at } = spawnLocalRunner(taskId, 'rl_env_clone_prod', params, params.slug);
  // ROK-1362 (Codex P2): honor wait:true — block ≤120s on the laptop task and
  // return the terminal status OR a still_running snapshot (the destructive
  // clone is genuinely in-flight; callers must not proceed on a bare dispatch).
  if (params.wait) {
    return waitLocalTask(taskId, params.wait_timeout_seconds);
  }
  return {
    ok: true,
    task_id: taskId,
    started_at,
    message: `Clone-prod started for ${params.slug} — poll rl_task_status ${taskId} or rl_task_wait ${taskId} (each wait caps at 120s).`,
  };
}
