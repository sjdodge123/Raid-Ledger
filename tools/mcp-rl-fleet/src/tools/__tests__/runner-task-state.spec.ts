// ROK-2202 (Codex P2 #2/#3) — what the detached runner writes must survive the
// real status path: runner-task-state writers → writeLocalTask (0600 JSON
// under a temp HOME) → readLocalTask (LocalTaskJsonSchema parse +
// toStatusReturn). A capturing ChainCtx mock cannot see either gap.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureTasksDir,
  localJsonPath,
  localLogPath,
  newLocalTaskId,
  readLocalTask,
  writeLocalTask,
  type LocalTaskJson,
} from '../../local-task.js';
import { applyDeployResult, makeChainCtx } from '../runner-task-state.js';

let homeDir: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env['HOME'];
  homeDir = mkdtempSync(join(tmpdir(), 'rl-runner-state-'));
  process.env['HOME'] = homeDir;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
  rmSync(homeDir, { recursive: true, force: true });
});

function freshTask(): LocalTaskJson {
  const id = newLocalTaskId();
  return {
    task_id: id, tool: 'rl_env_deploy', slot: null, args_summary: 'rok-test',
    started_at: '2026-11-14T00:00:00.000Z', finished_at: null, mcp_runtime_status: 'running',
    script_exit_code: null, steps: [], current_step: 'starting', log_path: localLogPath(id),
    pid: process.pid, failed_step: null,
  };
}

/** Drive the runner's own ctx against a real task JSON and read status back. */
function runnerTask(): { task: LocalTaskJson; ctx: ReturnType<typeof makeChainCtx>; status: () => ReturnType<typeof readLocalTask> } {
  const task = freshTask();
  writeLocalTask(task);
  const ctx = makeChainCtx(() => task, () => writeLocalTask(task));
  return { task, ctx, status: () => readLocalTask(task.task_id, 0) };
}

describe('runner task JSON → rl_task_status (ROK-2202)', () => {
  it('a step detail reaches rl_task_status (Codex P2 #2)', () => {
    const { ctx, status } = runnerTask();
    ctx.recordStep('sync_settings', true, 1.23, 'skipped_unusable: [blizzard_client_secret]');
    ctx.recordStep('env_spin', true, 2);
    expect(status().steps).toEqual([
      { name: 'sync_settings', status: 'PASS', duration_s: 1.2, detail: 'skipped_unusable: [blizzard_client_secret]' },
      { name: 'env_spin', status: 'PASS', duration_s: 2 },
    ]);
  });

  it('shared_keys_missing from the deploy result reaches rl_task_status (Codex P2 #3)', () => {
    const { task, status } = runnerTask();
    applyDeployResult(task, { ok: true, message: 'ok', shared_keys_missing: ['blizzard_client_secret'] });
    writeLocalTask(task);
    expect(status().shared_keys_missing).toEqual(['blizzard_client_secret']);
  });

  it('a deploy with nothing missing leaves shared_keys_missing unset', () => {
    const { task, status } = runnerTask();
    applyDeployResult(task, { ok: true, message: 'ok' });
    writeLocalTask(task);
    expect(status()).not.toHaveProperty('shared_keys_missing');
  });

  it('a task JSON written before ROK-2202 (no step detail, no shared_keys_missing) still parses', () => {
    const task = freshTask();
    ensureTasksDir();
    const legacy = { ...task, steps: [{ name: 'env_spin', status: 'PASS', duration_s: 3 }] };
    writeFileSync(localJsonPath(task.task_id), JSON.stringify(legacy));
    const st = readLocalTask(task.task_id, 0);
    expect(st.ok).toBe(true);
    expect(st.steps).toEqual([{ name: 'env_spin', status: 'PASS', duration_s: 3 }]);
  });
});
