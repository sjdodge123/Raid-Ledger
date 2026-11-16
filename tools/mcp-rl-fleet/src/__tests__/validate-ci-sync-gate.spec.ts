// ROK-2205 review M1 — the REAL path: rl_validate_ci dispatch runs the existing
// stale-build sync guard (sync-guard.ts) and records its verdict for the task;
// the terminal rl_task_status read then refuses the sentinel when the runner's
// /workspace was not verified against the worktree HEAD. Before this, nothing a
// validate-ci status carries could veto a sentinel, so the 2026-11-15 case (all
// PASS on a stale /workspace) still wrote one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SyncGuardResult } from '../sync-guard.js';

const SHA = '8fd1f515';
const FULL_SHA = `${SHA}0123456789abcdef0123456789abcdef`;
const SURFACE = 'a1b2c3d4e5f6';
const TASK_ID = 'ab12cd34ef56';

const GREEN_TAIL = [
  '========== Summary ==========',
  `${'Build (all workspaces)'.padEnd(30)}  PASS`,
  `${'TypeScript (all)'.padEnd(30)}  PASS`,
  `${'Lint (all)'.padEnd(30)}  PASS`,
  '',
].join('\n');

const guard = vi.hoisted(() => ({ result: null as SyncGuardResult | null }));

vi.mock('../sync-guard.js', () => ({
  ensureSyncedHead: vi.fn(async () => guard.result),
}));
vi.mock('../tools/runner-git.js', () => ({
  ensureRunnerGit: vi.fn(async () => undefined),
  resolveSlot: vi.fn(async () => 2),
  execFileP: vi.fn(async () => ({
    stdout: JSON.stringify({ task_id: 'ab12cd34ef56', started_at: '2026-11-16T00:00:00Z' }),
    stderr: '',
  })),
}));
vi.mock('../tools/worktree-sha.js', () => ({
  resolveWorktreeShortSha: vi.fn(async () => '8fd1f515'),
  resolveWorktreeSurfaceHash: vi.fn(async () => 'a1b2c3d4e5f6'),
  resolveWorktreeCommitSha: vi.fn(async () => ''),
}));
vi.mock('../exec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../exec.js')>()),
  getSshTarget: vi.fn(async () => ({ user: 'rl-agent', host: 'fleet.test' })),
  buildSshArgs: vi.fn(async (remote: string) => [remote]),
  execFileP: vi.fn(async () => ({
    stdout: JSON.stringify({
      ok: true,
      task_id: 'ab12cd34ef56',
      mcp_runtime_status: 'succeeded',
      steps: [],
      log_tail: GREEN_TAIL,
    }),
    stderr: '',
  })),
}));

const { execute } = await import('../tools/validate-ci.js');
const { executeStatus } = await import('../tools/task.js');
const { ensureSyncedHead } = await import('../sync-guard.js');

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'validate-ci-sync-gate-'));
  vi.stubEnv('RL_FLEET_STATE_DIR', join(dir, 'state'));
  vi.stubEnv('RL_PLAYWRIGHT_SENTINEL_DIR', dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const WORKTREE = '/tmp/rok-2205-worktree';
const sentinel = (): string => join(dir, `.playwright-verified-${SURFACE}`);

async function dispatchThenRead(): Promise<Awaited<ReturnType<typeof executeStatus>>> {
  await execute({ args: ['--static'], worktree_path: WORKTREE });
  return executeStatus({ task_id: TASK_ID, log_tail_bytes: 3000 });
}

describe('rl_validate_ci → rl_task_status — the dispatch-time sync guard (ROK-2205 M1)', () => {
  it('runs the sync guard on the claimed slot at dispatch', async () => {
    guard.result = { ok: true, expected_head: FULL_SHA, synced_head: FULL_SHA, resynced: false, attempts: 1, flush_ok: true, message: 'ok' };
    await execute({ args: ['--static'], worktree_path: WORKTREE });

    expect(ensureSyncedHead).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 2, worktree_path: WORKTREE, check_only: true }),
    );
  });

  it('refuses the sentinel on an all-PASS run whose runner tree was stale', async () => {
    guard.result = {
      ok: false,
      error: 'sync_stuck',
      expected_head: FULL_SHA,
      synced_head: null,
      resynced: true,
      attempts: 2,
      flush_ok: true,
      message: 'Sync STUCK',
    };
    const result = await dispatchThenRead();

    expect(result.gate_verified).toBe(false);
    expect(result.gate_error).toMatch(/stale sync/i);
    expect(existsSync(sentinel())).toBe(false);
  });

  it('writes the sentinel when the guard verified the worktree HEAD', async () => {
    guard.result = { ok: true, expected_head: FULL_SHA, synced_head: FULL_SHA, resynced: false, attempts: 1, flush_ok: true, message: 'ok' };
    const result = await dispatchThenRead();

    expect(result.gate_verified).toBe(true);
    expect(existsSync(sentinel())).toBe(true);
  });
});
