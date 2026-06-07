// ROK-1362 — detached laptop chain runner.
//
// Spawned (detached, unref'd) by spawnLocalRunner as:
//   npx tsx runner-entry.ts <taskId> <tool> <paramsJson>
// It runs the rl_env_deploy chain (env-deploy-steps) OR the rl_env_clone_prod
// chain (runCloneCore) to completion, streaming each step into the laptop task
// JSON (~/.raid-ledger/tasks/<id>.json) so rl_task_status shows per-step
// progress, then writes a TERMINAL JSON in a finally and exits with the chain's
// code. A crash before the finally is covered by the PID-liveness check on read.
//
// MUST NOT import ./index.js (that starts the MCP server). Imports only the
// chain modules + the laptop registry.

import {
  readRawLocalTask,
  writeLocalTask,
  localLogPath,
  type LocalTaskJson,
} from '../local-task.js';
import { runDeployChain, type ChainCtx } from './env-deploy-steps.js';
import { runCloneCore } from './env-clone-prod.js';
import type { EnvDeployParams } from './env-deploy.js';
import type { EnvCloneProdParams } from './env-clone-prod.js';

const [taskId, tool, paramsJson] = process.argv.slice(2);

function loadTask(): LocalTaskJson {
  const existing = readRawLocalTask(taskId);
  if (existing) return existing;
  // Race / missing: synthesize from our own pid so liveness still works.
  return {
    task_id: taskId,
    tool: tool as LocalTaskJson['tool'],
    slot: null,
    args_summary: '',
    started_at: new Date().toISOString(),
    finished_at: null,
    mcp_runtime_status: 'running',
    script_exit_code: null,
    steps: [],
    current_step: 'starting',
    log_path: localLogPath(taskId),
    pid: process.pid,
    failed_step: null,
  };
}

let current = loadTask();
const persist = (): void => writeLocalTask(current);

const ctx: ChainCtx = {
  setCurrent(step: string): void {
    current.current_step = step;
    persist();
  },
  recordStep(name, ok, tookS, _detail, _error): void {
    current.steps.push({ name, status: ok ? 'PASS' : 'FAIL', duration_s: Math.round(tookS * 10) / 10 });
    current.current_step = ok ? null : name;
    persist();
  },
};

function finalize(ok: boolean, opts: { failed_step?: string | null; error?: string; message: string }): void {
  current = {
    ...current,
    mcp_runtime_status: ok ? 'succeeded' : 'failed',
    finished_at: new Date().toISOString(),
    script_exit_code: ok ? 0 : 1,
    current_step: null,
    failed_step: opts.failed_step ?? null,
    error: opts.error,
    message: opts.message,
  };
  persist();
}

async function runDeploy(): Promise<number> {
  const params = JSON.parse(paramsJson) as EnvDeployParams;
  const res = await runDeployChain(params, ctx);
  if (typeof res.slot === 'number') current.slot = res.slot;
  finalize(res.ok, { failed_step: res.failed_step ?? null, error: res.error, message: res.message });
  return res.ok ? 0 : 1;
}

async function runClone(): Promise<number> {
  const params = JSON.parse(paramsJson) as EnvCloneProdParams;
  ctx.setCurrent('cloning prod → local → env');
  const cp = await runCloneCore(params);
  ctx.recordStep('clone_prod', cp.ok, 0, undefined, cp.ok ? undefined : cp.stderr);
  if (cp.restarted_for_settings !== undefined) {
    ctx.recordStep('restart_for_settings', !!cp.restarted_for_settings, 0, undefined, cp.restart_error);
  }
  finalize(cp.ok, {
    error: cp.ok ? undefined : 'clone_prod_failed',
    message: cp.ok
      ? `Cloned prod data into ${params.slug}.${cp.restarted_for_settings ? ' Restarted for settings.' : ''}`
      : `clone_prod failed: ${cp.stderr || 'unknown'}`,
  });
  return cp.ok ? 0 : 1;
}

// Cancel (SIGTERM from cancelLocalTask) — exit fast; cancelLocalTask owns the
// terminal `cancelled` write, so do NOT finalize here (would clobber it).
process.on('SIGTERM', () => process.exit(143));

async function main(): Promise<void> {
  let code = 1;
  try {
    code = tool === 'rl_env_clone_prod' ? await runClone() : await runDeploy();
  } catch (err) {
    const e = err as Error;
    finalize(false, { error: 'runner_crashed', message: `runner crashed: ${e.message}` });
    code = 1;
  }
  process.exit(code);
}

void main();
