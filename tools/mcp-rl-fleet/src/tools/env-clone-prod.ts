// rl_env_clone_prod — refresh operator's local DB from prod, then push to env.
//
// ROK-1362: now ASYNC by default. The clone runs on the OPERATOR LAPTOP (not the
// VM — task-start doesn't apply), so it dispatches a detached LAPTOP task
// (`local-<id>`) via the laptop task registry and returns {task_id} in ~1s. Poll
// rl_task_status / rl_task_wait (each wait caps at 120s) — uniform with the VM
// task surface. The synchronous chain body lives in runCloneCore so the
// rl_env_deploy chain (step 6) can call it inline inside its own runner.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildSshArgs } from '../exec.js';
import { newLocalTaskId, spawnLocalRunner, waitLocalTask } from '../local-task.js';
import type { ExecuteStatusReturn, StillRunningResult } from './task-schemas.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLONE_SCRIPT = resolve(__dirname, '../../../../scripts/clone-prod-to-env.sh');

export const TOOL_NAME = 'rl_env_clone_prod';
export const TOOL_DESCRIPTION =
  "Clone production data into a test env. Two-step: (1) refreshes the operator's local DB from prod via clone-prod-to-local.sh (sanitized backup; app_settings preserved), (2) pushes that snapshot into the test env via rl_env_sync_from_local in `full` mode. Requires .env.clone at repo root with PROD_URL + auth creds. The destructive `--fresh` flag is used implicitly — operator's LOCAL DB gets overwritten by prod data. Set skip_local_refresh=true to skip the prod→local step if you've recently cloned (faster). ASYNC (ROK-1362): runs as a detached LAPTOP task — returns {ok:true, task_id:'local-...', started_at} in ~1s. Poll rl_task_status local-... or rl_task_wait (each call caps at 120s and returns a still_running progress snapshot until the clone finishes). Do NOT block on a single long wait.";

export interface EnvCloneProdParams {
  slug: string;
  /** Skip the prod→local refresh step. Use after a recent clone-prod-to-local. */
  skip_local_refresh?: boolean;
  /** Soft timeout. Defaults to 1200 (20 min) — prod backup + download + restore can be slow. */
  timeout_seconds?: number;
  /** ROK-1362: wait:true blocks (≤120s) on the laptop task then returns the
   *  terminal status OR a still_running snapshot. Default false (returns task_id). */
  wait?: boolean;
  /** Wait budget when wait:true. Capped at 120s. */
  wait_timeout_seconds?: number;
}

export interface EnvCloneProdResult {
  ok: boolean;
  slug: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  /** Whether the allinone was restarted after the clone to refresh SettingsService cache. */
  restarted_for_settings?: boolean;
  restart_error?: string;
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
  const args = [params.slug];
  if (params.skip_local_refresh) args.push('--skip-local-refresh');
  let cloneResult: { stdout: string; stderr: string };
  try {
    cloneResult = await execFileAsync(CLONE_SCRIPT, args, {
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
      `DOCKER_HOST=tcp://127.0.0.1:2375 docker restart rl-env-${params.slug}-allinone && sleep 6`,
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
