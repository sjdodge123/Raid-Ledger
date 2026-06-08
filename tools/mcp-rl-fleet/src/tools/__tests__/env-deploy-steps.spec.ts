// ROK-1362 — runDeployChain (env-deploy-steps): the 6-step chain that used to
// live inline in env-deploy.execute. These preserve the old sync-guard coverage
// (fail-loud on sync_stuck, surface expected_head/synced_head, generic build
// failure, skip_build) at the new layer, plus the async build poll.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimExecute = vi.fn();
vi.mock('../claim.js', () => ({ execute: (...a: unknown[]) => claimExecute(...a) }));

const buildImageExecute = vi.fn();
vi.mock('../env-build-image.js', () => ({ execute: (...a: unknown[]) => buildImageExecute(...a) }));

const envSpinExecute = vi.fn();
vi.mock('../env-spin.js', () => ({ execute: (...a: unknown[]) => envSpinExecute(...a) }));

const envSyncExecute = vi.fn();
vi.mock('../env-sync.js', () => ({ execute: (...a: unknown[]) => envSyncExecute(...a) }));

vi.mock('../env-clone-prod.js', () => ({ runCloneCore: vi.fn() }));

const executeWait = vi.fn();
vi.mock('../task.js', () => ({ executeWait: (...a: unknown[]) => executeWait(...a) }));

vi.mock('../../exec.js', () => ({
  buildSshArgs: vi.fn(async () => ['-o', 'BatchMode=yes', 'rl-agent@host', 'noop']),
}));

import { runDeployChain, type ChainCtx } from '../env-deploy-steps.js';

const HEAD = 'e9995e61aabbccddeeff00112233445566778899';

interface Captured {
  steps: Array<{ name: string; ok: boolean }>;
  current: string[];
}
function makeCtx(): { ctx: ChainCtx; cap: Captured } {
  const cap: Captured = { steps: [], current: [] };
  const ctx: ChainCtx = {
    setCurrent: (s) => cap.current.push(s),
    recordStep: (name, ok) => cap.steps.push({ name, ok }),
  };
  return { ctx, cap };
}

beforeEach(() => {
  claimExecute.mockReset();
  buildImageExecute.mockReset();
  envSpinExecute.mockReset();
  envSyncExecute.mockReset();
  executeWait.mockReset();
  claimExecute.mockResolvedValue({ ok: true, slot: 2 });
});

describe('runDeployChain — sync guard (via build primitive)', () => {
  it('FAILS LOUD and spins nothing when the build dispatch reports sync_stuck', async () => {
    buildImageExecute.mockResolvedValue({
      ok: false,
      error: 'sync_stuck',
      expected_head: HEAD,
      synced_head: null,
      stderr: 'Sync STUCK: /workspace did not reflect laptop HEAD ...',
    });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain({ slug: 'rok-test', worktree_path: '/wt' }, ctx);

    expect(res.ok).toBe(false);
    expect(res.error).toBe('sync_stuck');
    expect(res.failed_step).toBe('sync_guard');
    expect(res.expected_head).toBe(HEAD);
    expect(res.synced_head).toBeNull();
    expect(cap.steps.find((s) => s.name === 'sync_guard')?.ok).toBe(false);
    expect(envSpinExecute).not.toHaveBeenCalled();
  });

  it('surfaces expected_head/synced_head from a healthy build + spin', async () => {
    buildImageExecute.mockResolvedValue({ ok: true, task_id: 't1', expected_head: HEAD, synced_head: HEAD });
    executeWait.mockResolvedValue({ ok: true, mcp_runtime_status: 'succeeded', steps: [] });
    envSpinExecute.mockResolvedValue({
      ok: true,
      url: 'https://slot-2.gamernight.net',
      admin_email: 'admin@local',
      admin_password: 'pw',
    });
    const { ctx } = makeCtx();
    const res = await runDeployChain({ slug: 'rok-test', worktree_path: '/wt', skip_sync: true }, ctx);

    expect(buildImageExecute).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.url).toBe('https://slot-2.gamernight.net');
    expect(res.expected_head).toBe(HEAD);
    expect(res.synced_head).toBe(HEAD);
  });

  it('a terminal non-succeeded build is a build_image_failed deploy failure', async () => {
    buildImageExecute.mockResolvedValue({ ok: true, task_id: 't1' });
    executeWait.mockResolvedValue({ ok: true, mcp_runtime_status: 'failed', message: 'docker build exited 1', steps: [] });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain({ slug: 'rok-test', worktree_path: '/wt' }, ctx);

    expect(res.ok).toBe(false);
    expect(res.error).toBe('build_image_failed');
    expect(cap.steps.find((s) => s.name === 'build_image')?.ok).toBe(false);
    expect(envSpinExecute).not.toHaveBeenCalled();
  });

  it('re-polls on a still_running build snapshot, then succeeds when terminal', async () => {
    buildImageExecute.mockResolvedValue({ ok: true, task_id: 't1', expected_head: HEAD, synced_head: HEAD });
    executeWait
      .mockResolvedValueOnce({ ok: false, status: 'still_running', current_step: 'docker build: step 12 of 45' })
      .mockResolvedValueOnce({ ok: true, mcp_runtime_status: 'succeeded', steps: [] });
    envSpinExecute.mockResolvedValue({ ok: true, url: 'https://slot-2.gamernight.net', admin_email: 'admin@local' });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain({ slug: 'rok-test', worktree_path: '/wt', skip_sync: true }, ctx);

    expect(executeWait).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    expect(cap.current).toContain('docker build: step 12 of 45');
  });

  it('skips the build (and its guard) entirely when skip_build=true', async () => {
    envSpinExecute.mockResolvedValue({ ok: true, url: 'https://slot-2.gamernight.net', admin_email: 'admin@local' });
    const { ctx } = makeCtx();
    const res = await runDeployChain({ slug: 'rok-test', worktree_path: '/wt', skip_build: true, skip_sync: true }, ctx);

    expect(buildImageExecute).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});
