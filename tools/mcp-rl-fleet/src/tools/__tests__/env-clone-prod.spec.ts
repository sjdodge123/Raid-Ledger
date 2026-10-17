// ROK-1362 — rl_env_clone_prod async dispatch + wait:true (Codex P2).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawnLocalRunner = vi.fn();
const waitLocalTask = vi.fn();
let idCounter = 0;
vi.mock('../../local-task.js', () => ({
  newLocalTaskId: () => `local-${(idCounter++).toString(16).padStart(12, '0')}`,
  spawnLocalRunner: (...a: unknown[]) => spawnLocalRunner(...a),
  waitLocalTask: (...a: unknown[]) => waitLocalTask(...a),
}));
// env-clone-prod imports buildSshArgs (used only in runCloneCore) — stub so the module loads.
vi.mock('../../exec.js', () => ({ buildSshArgs: vi.fn(async () => ['noop']) }));

import { execute, TOOL_DESCRIPTION } from '../env-clone-prod.js';

beforeEach(() => {
  spawnLocalRunner.mockReset();
  waitLocalTask.mockReset();
  idCounter = 0;
  spawnLocalRunner.mockReturnValue({ task_id: 'local-000000000000', pid: 999, started_at: '2026-06-07T00:00:00.000Z' });
});

describe('rl_env_clone_prod async dispatch', () => {
  it('wait:false dispatches a laptop runner and returns the task_id (no block)', async () => {
    const res = (await execute({ slug: 'rok-test' })) as { ok: boolean; task_id?: string };
    expect(res.ok).toBe(true);
    expect(res.task_id).toMatch(/^local-/);
    expect(spawnLocalRunner).toHaveBeenCalledWith(
      expect.stringMatching(/^local-/),
      'rl_env_clone_prod',
      expect.objectContaining({ slug: 'rok-test' }),
      'rok-test',
    );
    expect(waitLocalTask).not.toHaveBeenCalled();
  });

  it('wait:true blocks on the laptop task (≤120s) via waitLocalTask (Codex P2)', async () => {
    waitLocalTask.mockResolvedValue({ ok: true, mcp_runtime_status: 'succeeded', steps: [] });
    const res = (await execute({ slug: 'rok-test', wait: true, wait_timeout_seconds: 120 })) as {
      mcp_runtime_status?: string;
    };
    expect(spawnLocalRunner).toHaveBeenCalledTimes(1);
    expect(waitLocalTask).toHaveBeenCalledTimes(1);
    expect(res.mcp_runtime_status).toBe('succeeded');
  });

  it('TOOL_DESCRIPTION documents the async laptop-task + polling pattern', () => {
    expect(TOOL_DESCRIPTION).toMatch(/ASYNC/);
    expect(TOOL_DESCRIPTION).toMatch(/local-/);
    expect(TOOL_DESCRIPTION).toMatch(/rl_task_status|rl_task_wait/);
  });
});
