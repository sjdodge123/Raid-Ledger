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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCloneArgs,
  CLONE_SCRIPT,
  execute,
  resolveCloneScript,
  TOOL_DESCRIPTION,
} from '../env-clone-prod.js';

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

// ROK-2263 D15 — the caller's worktree runs its own clone scripts.
describe('rl_env_clone_prod worktree_path (D15)', () => {
  function makeTree(withScript: boolean): string {
    const tree = mkdtempSync(join(tmpdir(), 'clone-prod-tree-'));
    mkdirSync(join(tree, 'scripts'));
    if (withScript) writeFileSync(join(tree, 'scripts', 'clone-prod-to-env.sh'), '#!/bin/sh\n');
    return tree;
  }

  it("picks <worktree_path>/scripts/clone-prod-to-env.sh when that tree has it", () => {
    const tree = makeTree(true);
    try {
      expect(resolveCloneScript(tree)).toBe(join(tree, 'scripts', 'clone-prod-to-env.sh'));
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('falls back to the server checkout script when worktree_path is absent', () => {
    expect(resolveCloneScript(undefined)).toBe(CLONE_SCRIPT);
    expect(CLONE_SCRIPT).toMatch(/scripts\/clone-prod-to-env\.sh$/);
  });

  it('falls back to the server checkout script when the worktree has no clone script', () => {
    const tree = makeTree(false);
    try {
      expect(resolveCloneScript(tree)).toBe(CLONE_SCRIPT);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('passes --tree <worktree_path> after the slug and skip flag', () => {
    expect(buildCloneArgs({ slug: 'rok-1', skip_local_refresh: true, worktree_path: '/w/t' })).toEqual([
      'rok-1',
      '--skip-local-refresh',
      '--tree',
      '/w/t',
    ]);
  });

  it('sends no --tree when worktree_path is absent', () => {
    expect(buildCloneArgs({ slug: 'rok-1' })).toEqual(['rok-1']);
  });

  it('forwards worktree_path into the laptop runner params', async () => {
    spawnLocalRunner.mockReturnValue({ task_id: 'local-0', pid: 1, started_at: 'x' });
    await execute({ slug: 'rok-test', worktree_path: '/w/t' });
    expect(spawnLocalRunner).toHaveBeenCalledWith(
      expect.any(String),
      'rl_env_clone_prod',
      expect.objectContaining({ worktree_path: '/w/t' }),
      'rok-test',
    );
  });

  it('TOOL_DESCRIPTION documents worktree_path and the measure script', () => {
    expect(TOOL_DESCRIPTION).toMatch(/worktree_path/);
    expect(TOOL_DESCRIPTION).toMatch(/--tree/);
    expect(TOOL_DESCRIPTION).toMatch(/clone-prod-measure-migration\.sh/);
  });
});
