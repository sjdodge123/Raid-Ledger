// ROK-1362 — rl_env_deploy async dispatch wrapper.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawnLocalRunner = vi.fn();
const waitLocalTask = vi.fn();
let idCounter = 0;
vi.mock('../../local-task.js', () => ({
  newLocalTaskId: () => `local-${(idCounter++).toString(16).padStart(12, '0')}`,
  spawnLocalRunner: (...a: unknown[]) => spawnLocalRunner(...a),
  waitLocalTask: (...a: unknown[]) => waitLocalTask(...a),
}));

import { execute, TOOL_DESCRIPTION } from '../env-deploy.js';

beforeEach(() => {
  spawnLocalRunner.mockReset();
  waitLocalTask.mockReset();
  idCounter = 0;
  spawnLocalRunner.mockReturnValue({ task_id: 'local-000000000000', pid: 4242, started_at: '2026-06-07T00:00:00.000Z' });
});

describe('rl_env_deploy async-by-default', () => {
  it('wait:false returns a local- task_id within ~1s (spawns a detached runner)', async () => {
    const t0 = Date.now();
    const res = (await execute({ slug: 'rok-test', worktree_path: '/wt' })) as {
      ok: boolean;
      task_id?: string;
      message?: string;
    };
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(res.ok).toBe(true);
    expect(res.task_id).toMatch(/^local-[a-z0-9]{8,32}$/);
    expect(res.message).toMatch(/rl_task_status|rl_task_wait/);
    // The chain runs detached — spawnLocalRunner is the dispatch.
    expect(spawnLocalRunner).toHaveBeenCalledTimes(1);
    expect(spawnLocalRunner).toHaveBeenCalledWith(
      expect.stringMatching(/^local-/),
      'rl_env_deploy',
      expect.objectContaining({ slug: 'rok-test' }),
      'rok-test',
    );
    expect(waitLocalTask).not.toHaveBeenCalled();
  });

  it('wait:true blocks on the laptop task (≤120s) via waitLocalTask', async () => {
    waitLocalTask.mockResolvedValue({ ok: true, mcp_runtime_status: 'succeeded', steps: [] });
    const res = (await execute({ slug: 'rok-test', wait: true, wait_timeout_seconds: 120 })) as {
      mcp_runtime_status?: string;
    };
    expect(spawnLocalRunner).toHaveBeenCalledTimes(1);
    expect(waitLocalTask).toHaveBeenCalledTimes(1);
    expect(res.mcp_runtime_status).toBe('succeeded');
  });

  it('TOOL_DESCRIPTION documents the async + 120s-cap polling pattern', () => {
    expect(TOOL_DESCRIPTION).toMatch(/ASYNC BY DEFAULT/);
    expect(TOOL_DESCRIPTION).toMatch(/120s/);
    expect(TOOL_DESCRIPTION).not.toMatch(/this tool is SYNC/);
  });
});
