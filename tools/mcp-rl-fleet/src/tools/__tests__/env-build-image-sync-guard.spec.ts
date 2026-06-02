// rl_env_build_image_from_runner — the sync guard now lives in THIS primitive
// (Codex review 2026-06-02, high-1) so the standalone build + parallel-deploy
// paths can't build stale source. Verify it gates dispatch.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimExecute = vi.fn();
vi.mock('../claim.js', () => ({ execute: (...a: unknown[]) => claimExecute(...a) }));

const ensureSyncedHead = vi.fn();
vi.mock('../../sync-guard.js', () => ({
  ensureSyncedHead: (...a: unknown[]) => ensureSyncedHead(...a),
}));

vi.mock('../task.js', () => ({ executeWait: vi.fn() }));

// Stub exec.js so the SSH-arg builders don't hit DNS, and so the only real
// child-process boundary is execFile (mocked below) for the task dispatch.
vi.mock('../../exec.js', () => ({
  buildSshArgs: vi.fn(async () => ['-o', 'BatchMode=yes', 'rl-agent@host', 'remote']),
  deriveAgentId: vi.fn(() => 'agent-x'),
  shellQuote: (s: string) => `'${s}'`,
  synthesizeEmptyStderrDiagnostic: vi.fn(() => 'synth'),
}));

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execFileSync: (...args: unknown[]) => mockExecFile(...args),
  default: {
    execFile: (...args: unknown[]) => mockExecFile(...args),
    execFileSync: (...args: unknown[]) => mockExecFile(...args),
  },
}));

import { execute } from '../env-build-image.js';

const HEAD = 'e9995e61aabbccddeeff00112233445566778899';

/** Make execFile (the SSH dispatch) succeed with a task-start JSON payload. */
function dispatchOk(): void {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, JSON.stringify({ task_id: 'abc123', started_at: '2026-06-02T00:00:00Z' }), '');
    },
  );
}

beforeEach(() => {
  claimExecute.mockReset();
  ensureSyncedHead.mockReset();
  mockExecFile.mockReset();
  claimExecute.mockResolvedValue({ ok: true, slot: 1 });
});

describe('rl_env_build_image_from_runner sync guard', () => {
  it('FAILS LOUD and does NOT dispatch a build when the guard reports sync_stuck', async () => {
    ensureSyncedHead.mockResolvedValue({
      ok: false,
      error: 'sync_stuck',
      expected_head: HEAD,
      synced_head: null,
      message: 'Sync STUCK: /workspace did not reflect laptop HEAD e9995e6 ...',
    });

    const res = await execute({ tag: 'rok-test', worktree_path: '/wt' });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('sync_stuck');
    expect(res.expected_head).toBe(HEAD);
    expect(res.synced_head).toBeNull();
    // Critical: the build was never dispatched over SSH.
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('dispatches the build and surfaces heads when the guard passes', async () => {
    ensureSyncedHead.mockResolvedValue({
      ok: true,
      expected_head: HEAD,
      synced_head: HEAD,
      resynced: false,
      message: 'in sync',
    });
    dispatchOk();

    const res = await execute({ tag: 'rok-test', worktree_path: '/wt' }); // wait:false default

    expect(ensureSyncedHead).toHaveBeenCalledWith({ slot: 1, worktree_path: '/wt' });
    expect(mockExecFile).toHaveBeenCalledTimes(1); // the SSH task dispatch
    expect(res.ok).toBe(true);
    expect(res.task_id).toBe('abc123');
    expect(res.expected_head).toBe(HEAD);
    expect(res.synced_head).toBe(HEAD);
  });
});
