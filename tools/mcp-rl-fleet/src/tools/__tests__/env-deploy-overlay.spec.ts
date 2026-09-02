// ROK-1469 D6 — rl_env_deploy no longer depends on the operator's laptop DB.
//
// sync_settings pg_dumps app_settings out of the local raid-ledger-db
// container. On 2026-09-02, with Docker Desktop off, that step failed and the
// whole deploy was reported FAILED even though the env was healthy — and any
// env that DID deploy came up with no API keys. The settings overlay reads the
// VM-side encrypted bundle instead, so a laptop-less deploy is a success.
//
// The downgrade is narrow on purpose: sync failing while the overlay applies
// NOTHING is still a hard failure. Reporting "deployed" for an env with no
// credentials is the failure mode this whole step exists to prevent.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimExecute = vi.fn();
vi.mock('../claim.js', () => ({ execute: (...a: unknown[]) => claimExecute(...a) }));
const envSpinExecute = vi.fn();
vi.mock('../env-spin.js', () => ({ execute: (...a: unknown[]) => envSpinExecute(...a) }));
const envSyncExecute = vi.fn();
vi.mock('../env-sync.js', () => ({ execute: (...a: unknown[]) => envSyncExecute(...a) }));
const overlayRun = vi.fn();
vi.mock('../env-settings-overlay.js', () => ({
  runSettingsOverlay: (...a: unknown[]) => overlayRun(...a),
}));
vi.mock('../env-build-image.js', () => ({ execute: vi.fn() }));
vi.mock('../env-clone-prod.js', () => ({ runCloneCore: vi.fn() }));
vi.mock('../task.js', () => ({ executeWait: vi.fn() }));
vi.mock('../../exec.js', () => ({
  buildSshArgs: vi.fn(async () => ['-o', 'BatchMode=yes', 'rl-agent@host', 'noop']),
}));
// restartAllinone shells out over ssh; stub the child process so the chain
// runs offline (the restart itself is not what these tests are about).
vi.mock('node:child_process', () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    opts: unknown,
    cb?: (e: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const done = typeof opts === 'function' ? (opts as (e: Error | null, o: string, s: string) => void) : cb;
    done?.(null, '', '');
  },
}));

import { runDeployChain, type ChainCtx } from '../env-deploy-steps.js';

interface Captured {
  steps: Array<{ name: string; ok: boolean }>;
}
function makeCtx(): { ctx: ChainCtx; cap: Captured } {
  const cap: Captured = { steps: [] };
  return {
    cap,
    ctx: { setCurrent: () => {}, recordStep: (name, ok) => cap.steps.push({ name, ok }) },
  };
}

const PARAMS = { slug: 'demo', branch: 'rok-1469', skip_build: true };

beforeEach(() => {
  claimExecute.mockReset().mockResolvedValue({ ok: true, slot: 2 });
  envSpinExecute.mockReset().mockResolvedValue({
    ok: true,
    url: 'https://slot-2.gamernight.net',
    admin_email: 'admin@local',
  });
  envSyncExecute.mockReset();
  overlayRun.mockReset().mockResolvedValue({ ok: true, applied: [] });
});

describe('runDeployChain — settings overlay (ROK-1469)', () => {
  it('succeeds when sync_settings fails but the overlay seeds keys from the bundle', async () => {
    envSyncExecute.mockResolvedValue({ ok: false, stderr: 'docker: daemon not running' });
    overlayRun.mockResolvedValue({
      ok: true,
      applied: ['itad_api_key', 'discord_bot_token'],
    });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(true);
    expect(cap.steps).toContainEqual({ name: 'settings_overlay', ok: true });
    expect(res.message).toMatch(/bundle|overlay/i);
  });

  it('still FAILS when sync_settings fails and the overlay applied nothing', async () => {
    envSyncExecute.mockResolvedValue({ ok: false, stderr: 'docker: daemon not running' });
    overlayRun.mockResolvedValue({ ok: true, applied: [] });
    const { ctx } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(false);
    expect(res.failed_step).toBe('sync_settings');
  });

  it('runs the overlay after a SUCCESSFUL sync so the slot identity wins', async () => {
    envSyncExecute.mockResolvedValue({ ok: true });
    overlayRun.mockResolvedValue({ ok: true, applied: ['discord_bot_token'] });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(true);
    const order = cap.steps.map((s) => s.name);
    expect(order.indexOf('settings_overlay')).toBeGreaterThan(order.indexOf('sync_settings'));
  });

  it('records a failed overlay without failing an otherwise healthy deploy', async () => {
    envSyncExecute.mockResolvedValue({ ok: true });
    overlayRun.mockResolvedValue({ ok: false, applied: [], error: 'settings_overlay_failed' });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(true);
    expect(cap.steps).toContainEqual({ name: 'settings_overlay', ok: false });
  });

  it('skips the overlay entirely when skip_sync is set', async () => {
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain({ ...PARAMS, skip_sync: true } as never, ctx);
    expect(res.ok).toBe(true);
    expect(overlayRun).not.toHaveBeenCalled();
    expect(cap.steps.some((s) => s.name === 'settings_overlay')).toBe(false);
  });
});
