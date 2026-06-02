// rl_env_deploy — sync-guard gating via the build primitive (TECH-DEBT 2026-06-02).
//
// The pre-build sync guard now lives INSIDE env-build-image.execute (so the
// standalone primitive is covered too). env-deploy must:
//   1. Treat a build result with error="sync_stuck" as a top-level deploy
//      failure (error=sync_stuck) and NOT spin an env — no stale tree deployed.
//   2. Surface the build's expected_head / synced_head on the deploy result.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimExecute = vi.fn();
vi.mock('../claim.js', () => ({ execute: (...a: unknown[]) => claimExecute(...a) }));

const buildImageExecute = vi.fn();
vi.mock('../env-build-image.js', () => ({ execute: (...a: unknown[]) => buildImageExecute(...a) }));

const envSpinExecute = vi.fn();
vi.mock('../env-spin.js', () => ({ execute: (...a: unknown[]) => envSpinExecute(...a) }));

const envSyncExecute = vi.fn();
vi.mock('../env-sync.js', () => ({ execute: (...a: unknown[]) => envSyncExecute(...a) }));

vi.mock('../env-clone-prod.js', () => ({ execute: vi.fn() }));

// env-deploy imports buildSshArgs (used only on the settings-restart path,
// which we skip via skip_sync). Provide a stub so the module loads.
vi.mock('../../exec.js', () => ({
  buildSshArgs: vi.fn(async () => ['-o', 'BatchMode=yes', 'rl-agent@host', 'noop']),
}));

import { execute } from '../env-deploy.js';

const HEAD = 'e9995e61aabbccddeeff00112233445566778899';

beforeEach(() => {
  claimExecute.mockReset();
  buildImageExecute.mockReset();
  envSpinExecute.mockReset();
  envSyncExecute.mockReset();
  claimExecute.mockResolvedValue({ ok: true, slot: 2 });
});

describe('rl_env_deploy sync guard (via build primitive)', () => {
  it('FAILS LOUD and spins nothing when the build guard reports sync_stuck', async () => {
    buildImageExecute.mockResolvedValue({
      ok: false,
      error: 'sync_stuck',
      expected_head: HEAD,
      synced_head: null,
      stderr: 'Sync STUCK: /workspace did not reflect laptop HEAD e9995e6 ...',
    });

    const res = await execute({ slug: 'rok-test', worktree_path: '/wt' });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('sync_stuck');
    expect(res.expected_head).toBe(HEAD);
    expect(res.synced_head).toBeNull();
    expect(res.steps.sync_guard.ok).toBe(false);
    // The whole point: a stale tree must NOT be spun into an env.
    expect(envSpinExecute).not.toHaveBeenCalled();
  });

  it('surfaces expected_head/synced_head from a healthy build', async () => {
    buildImageExecute.mockResolvedValue({
      ok: true,
      image: 'registry/x:rok-test',
      duration_s: 42,
      expected_head: HEAD,
      synced_head: HEAD,
    });
    envSpinExecute.mockResolvedValue({
      ok: true,
      url: 'https://slot-2.gamernight.net',
      internal_url: 'http://10.0.0.2',
      slot_url: 'https://slot-2.gamernight.net',
      admin_email: 'admin@local',
      admin_password: 'pw',
      bootstrap_warnings: [],
    });

    const res = await execute({ slug: 'rok-test', worktree_path: '/wt', skip_sync: true });

    expect(buildImageExecute).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.expected_head).toBe(HEAD);
    expect(res.synced_head).toBe(HEAD);
  });

  it('a non-sync build failure stays a generic build_image failure (no sync_stuck error)', async () => {
    buildImageExecute.mockResolvedValue({
      ok: false,
      error: 'build_image_failed',
      stderr: 'docker build exited 1',
    });

    const res = await execute({ slug: 'rok-test', worktree_path: '/wt' });

    expect(res.ok).toBe(false);
    expect(res.error).toBeUndefined();
    expect(res.steps.build_image.ok).toBe(false);
    expect(res.message).toContain('build_image step failed');
  });

  it('skips the build (and its guard) entirely when skip_build=true', async () => {
    envSpinExecute.mockResolvedValue({
      ok: true,
      url: 'https://slot-2.gamernight.net',
      admin_email: 'admin@local',
      admin_password: 'pw',
      bootstrap_warnings: [],
    });

    const res = await execute({ slug: 'rok-test', worktree_path: '/wt', skip_build: true, skip_sync: true });

    expect(buildImageExecute).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});
