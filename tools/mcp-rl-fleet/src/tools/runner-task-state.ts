// The detached laptop runner's task-JSON writers (runner-entry.ts).
//
// Kept out of runner-entry.ts so they are unit-testable: that module runs its
// chain at import time from process.argv. Every write here lands in the 0600
// laptop task JSON that rl_task_status (local-task.ts) reads back.

import type { LocalTaskJson } from '../local-task.js';
import type { ChainCtx, DeployChainResult } from './env-deploy-steps.js';

/**
 * The ChainCtx the deploy/clone/spin chains report into. `task` is a getter
 * because the runner replaces its task object on finalize.
 */
export function makeChainCtx(task: () => LocalTaskJson, persist: () => void): ChainCtx {
  return {
    setCurrent(step: string): void {
      task().current_step = step;
      persist();
    },
    recordStep(name, ok, tookS, _detail, _error): void {
      const t = task();
      t.steps.push({ name, status: ok ? 'PASS' : 'FAIL', duration_s: Math.round(tookS * 10) / 10 });
      t.current_step = ok ? null : name;
      persist();
    },
  };
}

/**
 * ROK-1362 (Codex P1): persist the deploy result fields so a terminal
 * rl_task_status local-... exposes the shareable URL + admin login.
 */
export function applyDeployResult(task: LocalTaskJson, res: DeployChainResult): void {
  if (typeof res.slot === 'number') task.slot = res.slot;
  task.url = res.url ?? null;
  task.internal_url = res.internal_url ?? null;
  task.slot_url = res.slot_url ?? null;
  task.admin_email = res.admin_email ?? null;
  task.admin_password = res.admin_password ?? null;
  task.expected_head = res.expected_head ?? null;
  task.synced_head = res.synced_head ?? null;
}
