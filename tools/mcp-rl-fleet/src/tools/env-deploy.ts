// rl_env_deploy — end-to-end "deploy this branch to a test env" workflow.
//
// ROK-1362: ASYNC BY DEFAULT. The 6-step chain (claim → build → spin → sync →
// restart → optional clone) reads the operator's LOCAL DB at sync/clone time, so
// it cannot be a VM task. Instead it runs in a detached LAPTOP runner
// (runner-entry.ts → env-deploy-steps.runDeployChain) and this tool returns a
// `local-<id>` task_id in ~1s. Poll rl_task_status / rl_task_wait (each wait caps
// at 120s, returning a still_running progress snapshot until the chain finishes).
// The chain logic itself lives in env-deploy-steps.ts.

import {
  newLocalTaskId,
  spawnLocalRunner,
  waitLocalTask,
  type SpawnLocalRunnerResult,
} from '../local-task.js';
import type { ExecuteStatusReturn, StillRunningResult } from './task-schemas.js';

export const TOOL_NAME = 'rl_env_deploy';
export const TOOL_DESCRIPTION =
  "Single-call branch deployment: claim a runner slot, build the allinone image from the agent's CURRENT BRANCH (Mutagen-synced /workspace), spin a per-test env using that image, sync the operator's app_settings (API keys, OAuth configs), restart for the new settings, and optionally clone sanitized prod data (clone_prod=true). ASYNC BY DEFAULT (ROK-1362): returns {ok:true, task_id:'local-...', started_at} in ~1s; the 6-step chain then runs in a detached LAPTOP process and streams steps[] into the task JSON. Poll rl_task_status local-... or rl_task_wait local-... (each wait caps at 120s and returns a still_running snapshot with the current step + a small log_tail until the chain finishes). The shareable env URL arrives in the terminal status `message`/`url` once the env_spin step completes. Do NOT block on a single long wait. Set wait:true to block up to wait_timeout_seconds (≤120s) and get the terminal status (or a still_running snapshot) back inline. Idempotent on the slug.";

export interface EnvDeployParams {
  /** Env slug — also used as the image tag. [a-z0-9-]+. */
  slug: string;
  /** Branch label recorded on the claim. Auto-detected from cwd if absent. */
  branch?: string;
  /** Absolute path to the agent's worktree (Mutagen sync + agent_id). */
  worktree_path?: string;
  /** Skip the app_settings sync step (faster, but env starts empty). */
  skip_sync?: boolean;
  /** Skip rebuild — use a previously-built image with this slug as tag. */
  skip_build?: boolean;
  /** Also clone sanitized prod data into the env after the settings sync. */
  clone_prod?: boolean;
  /** When clone_prod=true, skip the prod→local refresh step (faster). */
  clone_prod_skip_local_refresh?: boolean;
  /** Soft timeout for the (VM-side) build step. Defaults to 1800 (30 min). */
  timeout_seconds?: number;
  /** ROK-1362: wait:true blocks (≤120s) on the laptop task then returns the
   *  terminal status OR a still_running snapshot. Default false (returns task_id). */
  wait?: boolean;
  /** Wait budget when wait:true. Capped at 120s. */
  wait_timeout_seconds?: number;
}

export interface EnvDeployDispatch {
  ok: boolean;
  task_id?: string;
  started_at?: string;
  message?: string;
  error?: string;
}

export async function execute(
  params: EnvDeployParams,
): Promise<EnvDeployDispatch | ExecuteStatusReturn | StillRunningResult> {
  const taskId = newLocalTaskId();
  const spawned: SpawnLocalRunnerResult = spawnLocalRunner(
    taskId,
    'rl_env_deploy',
    params,
    params.slug,
  );

  if (params.wait) {
    return waitLocalTask(taskId, params.wait_timeout_seconds);
  }
  return {
    ok: true,
    task_id: taskId,
    started_at: spawned.started_at,
    message: `Deploy chain started for ${params.slug} — poll rl_task_status ${taskId} or rl_task_wait ${taskId} (each wait caps at 120s; the env URL lands in the status message once env_spin completes).`,
  };
}
