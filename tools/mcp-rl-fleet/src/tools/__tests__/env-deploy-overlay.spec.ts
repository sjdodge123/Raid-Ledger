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
// Partial mock: only the SSH-bound runner is faked. countSharedKeys is pure
// and is exactly the identity-vs-shared distinction under test here.
vi.mock('../env-settings-overlay.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../env-settings-overlay.js')>()),
  runSettingsOverlay: (...a: unknown[]) => overlayRun(...a),
}));
vi.mock('../env-build-image.js', () => ({ execute: vi.fn() }));
const cloneCore = vi.fn();
vi.mock('../env-clone-prod.js', () => ({ runCloneCore: (...a: unknown[]) => cloneCore(...a) }));
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
import { countSharedKeys } from '../env-settings-overlay.js';

// What rl-infra/orchestrator/bin/env-settings-overlay ALWAYS writes, bundle or
// not: the slot's Discord identity (_bot_identity.sh) plus the demo_mode flag
// (merged unconditionally since #1123). Fixtures must carry these, or they
// model an overlay the VM never produces — which is how ROK-1339's safety net
// sat dead behind a green suite.
const ALWAYS_SEEDED = [
  'discord_bot_token',
  'discord_bot_enabled',
  'discord_client_id',
  'discord_client_secret',
  'demo_mode',
];

interface Captured {
  steps: Array<{ name: string; ok: boolean }>;
  details: Record<string, string | undefined>;
}
function makeCtx(): { ctx: ChainCtx; cap: Captured } {
  const cap: Captured = { steps: [], details: {} };
  return {
    cap,
    ctx: {
      setCurrent: () => {},
      recordStep: (name, ok, _s, detail) => {
        cap.steps.push({ name, ok });
        cap.details[name] = detail;
      },
    },
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
  cloneCore.mockReset().mockResolvedValue({ ok: true, restarted_for_settings: true });
});

describe('runDeployChain — settings overlay (ROK-1469)', () => {
  it('succeeds when sync_settings fails but the overlay seeds keys from the bundle', async () => {
    envSyncExecute.mockResolvedValue({ ok: false, stderr: 'docker: daemon not running' });
    overlayRun.mockResolvedValue({
      ok: true,
      applied: ['itad_api_key', ...ALWAYS_SEEDED],
    });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(true);
    expect(cap.steps).toContainEqual({ name: 'settings_overlay', ok: true });
    expect(res.message).toMatch(/bundle|overlay/i);
  });

  it('counts neither the slot identity nor demo_mode as shared bundle keys', () => {
    expect(countSharedKeys(ALWAYS_SEEDED)).toBe(0);
    expect(countSharedKeys([...ALWAYS_SEEDED, 'itad_api_key'])).toBe(1);
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
    overlayRun.mockResolvedValue({ ok: true, applied: ALWAYS_SEEDED });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(true);
    const order = cap.steps.map((s) => s.name);
    expect(order.indexOf('settings_overlay')).toBeGreaterThan(order.indexOf('sync_settings'));
  });

  it('surfaces the bundle warning on a GREEN deploy (message and step detail)', async () => {
    // A healthy laptop sync masks an absent/undecryptable bundle; the warning
    // must still reach the caller, or the next laptop-less deploy is a surprise.
    const warning = 'settings bundle absent at /srv/rl-infra/settings/bundle.enc';
    envSyncExecute.mockResolvedValue({ ok: true });
    overlayRun.mockResolvedValue({ ok: true, applied: ALWAYS_SEEDED, bundle_warning: warning });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(true);
    expect(res.message).toContain(warning);
    expect(cap.details.settings_overlay).toContain(warning);
  });

  it('records a failed overlay without failing an otherwise healthy deploy', async () => {
    envSyncExecute.mockResolvedValue({ ok: true });
    overlayRun.mockResolvedValue({ ok: false, applied: [], error: 'settings_overlay_failed' });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(true);
    expect(cap.steps).toContainEqual({ name: 'settings_overlay', ok: false });
  });

  it('an identity + demo_mode overlay does not rescue a failed sync (no shared keys)', async () => {
    // The overlay always writes the slot's Discord identity AND demo_mode.
    // Counting either as "settings seeded" would report a green deploy for an
    // env with no IGDB/ITAD/Blizzard/LLM credentials at all — the exact
    // silent-failure this step exists to prevent (dead 2026-09-09 → 09-26
    // because demo_mode was counted as a shared key).
    envSyncExecute.mockResolvedValue({ ok: false, stderr: 'docker: daemon not running' });
    overlayRun.mockResolvedValue({ ok: true, applied: ALWAYS_SEEDED });
    const { ctx } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(false);
    expect(res.failed_step).toBe('sync_settings');
    expect(res.message).toMatch(/shared/i);
  });

  it('names the bundle warning when the sync failed and the bundle was unusable', async () => {
    envSyncExecute.mockResolvedValue({ ok: false, stderr: 'docker: daemon not running' });
    overlayRun.mockResolvedValue({
      ok: true,
      applied: ALWAYS_SEEDED,
      bundle_warning: 'settings bundle could not be decrypted (wrong RL_SETTINGS_BUNDLE_KEY)',
    });
    const { ctx } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/RL_SETTINGS_BUNDLE_KEY/);
  });

  it('re-applies the overlay AFTER clone_prod, which re-syncs app_settings', async () => {
    // runCloneCore shells out to sync-local-to-env.sh, which rewrites
    // app_settings from the laptop — running the overlay before it would
    // leave the env on the operator's shared bot identity.
    envSyncExecute.mockResolvedValue({ ok: true });
    overlayRun.mockResolvedValue({ ok: true, applied: ['itad_api_key', ...ALWAYS_SEEDED] });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain({ ...PARAMS, clone_prod: true } as never, ctx);
    expect(res.ok).toBe(true);
    const order = cap.steps.map((s) => s.name);
    expect(order.indexOf('settings_overlay')).toBeGreaterThan(order.indexOf('clone_prod'));
    expect(order.indexOf('restart_for_settings')).toBeGreaterThan(order.indexOf('settings_overlay'));
  });

  it('skips the overlay entirely when skip_sync is set', async () => {
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain({ ...PARAMS, skip_sync: true } as never, ctx);
    expect(res.ok).toBe(true);
    expect(overlayRun).not.toHaveBeenCalled();
    expect(cap.steps.some((s) => s.name === 'settings_overlay')).toBe(false);
  });
});
