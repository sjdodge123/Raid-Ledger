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
// The remote command is the LAST ssh arg, so the child-process stub can tell
// the overlay from the restart (and the sync-wins call from its retry).
vi.mock('../../exec.js', () => ({
  buildSshArgs: vi.fn(async (cmd: string) => ['-o', 'BatchMode=yes', 'rl-agent@host', cmd]),
}));
// restartAllinone and the real runSettingsOverlay shell out over ssh; stub the
// child process so the chain runs offline. childExec resolves { stdout,
// stderr } (what promisify(execFile) yields) or rejects like a non-zero exit.
type ExecOut = { stdout: string; stderr: string };
const childExec = vi.fn(async (_cmd: string, _args: string[]): Promise<ExecOut> => ({ stdout: '', stderr: '' }));
vi.mock('node:child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    opts: unknown,
    cb?: (e: Error | null, out?: ExecOut) => void,
  ) => {
    const done = typeof opts === 'function' ? (opts as (e: Error | null, out?: ExecOut) => void) : cb;
    childExec(cmd, args).then((out) => done?.(null, out), (err: Error) => done?.(err));
  },
}));

import { runDeployChain, type ChainCtx } from '../env-deploy-steps.js';
import { SYNC_WINS_NOT_HONOURED, countSharedKeys } from '../env-settings-overlay.js';
import { buildSshArgs } from '../../exec.js';

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
  childExec.mockReset().mockResolvedValue({ stdout: '', stderr: '' });
  vi.mocked(buildSshArgs).mockClear();
});

const OVERLAY_BIN = '/srv/rl-infra/orchestrator/bin/env-settings-overlay';
const realOverlay = () =>
  vi.importActual<typeof import('../env-settings-overlay.js')>('../env-settings-overlay.js');
/** The ssh remote commands issued so far (last arg of each buildSshArgs call). */
const remoteCommands = () => vi.mocked(buildSshArgs).mock.calls.map((c) => c[0]);

/**
 * A VM orchestrator deployed before --sync-wins existed: its arg loop
 * rejects the flag (`*) echo "unknown arg: $1" >&2; exit 2`), and a plain
 * run applies the whole bundle and never reports sync_wins.
 */
function oldOrchestrator(applied: string[]): void {
  childExec.mockImplementation(async (_cmd, args) => {
    const remote = args[args.length - 1] ?? '';
    if (!remote.startsWith(OVERLAY_BIN)) return { stdout: '', stderr: '' };
    if (remote.includes('--sync-wins')) {
      throw Object.assign(new Error('Command failed: ssh'), { code: 2, stderr: 'unknown arg: --sync-wins\n' });
    }
    return { stdout: `${JSON.stringify({ ok: true, applied, slot: 2 })}\n`, stderr: '' };
  });
}

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

// Operator ruling 2026-09-27: "When the laptop sync succeeds, the overlay
// applies only the slot-identity keys and skips the keys the sync just
// copied. The bundle still fills everything when the sync fails or is
// skipped." So after a good sync the overlay runs with --sync-wins: identity
// UPSERTed, every other bundle key inserted only where the sync left no row.
describe('runDeployChain — settings precedence (a fresh sync wins)', () => {
  it('asks for a sync-wins overlay after a SUCCESSFUL sync', async () => {
    envSyncExecute.mockResolvedValue({ ok: true });
    overlayRun.mockResolvedValue({ ok: true, applied: ALWAYS_SEEDED, sync_wins: true });
    const { ctx } = makeCtx();
    await runDeployChain(PARAMS as never, ctx);
    expect(overlayRun).toHaveBeenCalledWith('demo', { syncWins: true });
  });

  it('asks for a FULL overlay when the sync failed (laptop DB unavailable)', async () => {
    envSyncExecute.mockResolvedValue({ ok: false, stderr: 'laptop DB unavailable' });
    overlayRun.mockResolvedValue({ ok: true, applied: ['itad_api_key', ...ALWAYS_SEEDED] });
    const { ctx } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(overlayRun).toHaveBeenCalledWith('demo', { syncWins: false });
    expect(res.ok).toBe(true);
  });

  it('treats a successful clone_prod like a sync: it rewrote app_settings from the laptop', async () => {
    envSyncExecute.mockResolvedValue({ ok: false, stderr: 'transient ssh reset' });
    overlayRun.mockResolvedValue({ ok: true, applied: ALWAYS_SEEDED, kept_synced: ['itad_api_key'], sync_wins: true });
    const { ctx } = makeCtx();
    const res = await runDeployChain({ ...PARAMS, clone_prod: true } as never, ctx);
    expect(overlayRun).toHaveBeenCalledWith('demo', { syncWins: true });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/clone_prod/);
  });

  it('a FAILED clone_prod after a failed sync still gets the full bundle', async () => {
    envSyncExecute.mockResolvedValue({ ok: false, stderr: 'laptop DB unavailable' });
    cloneCore.mockResolvedValue({ ok: false, stderr: 'clone failed' });
    overlayRun.mockResolvedValue({ ok: true, applied: ['itad_api_key', ...ALWAYS_SEEDED] });
    const { ctx } = makeCtx();
    await runDeployChain({ ...PARAMS, clone_prod: true } as never, ctx);
    expect(overlayRun).toHaveBeenCalledWith('demo', { syncWins: false });
  });

  it('surfaces the filled/kept counts and the bundle warning on a sync-wins run', async () => {
    const warning = 'settings bundle absent at /srv/rl-infra/settings/bundle.enc';
    envSyncExecute.mockResolvedValue({ ok: true });
    overlayRun.mockResolvedValue({
      ok: true,
      applied: ALWAYS_SEEDED,
      inserted_if_absent: ['blizzard_client_secret'],
      kept_synced: ['itad_api_key', 'igdb_client_secret'],
      sync_wins: true,
      bundle_warning: warning,
    });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    const counts = /1 bundle key\(s\) filled where absent, 2 kept from the sync/;
    expect(cap.details.settings_overlay).toMatch(counts);
    expect(cap.details.settings_overlay).toContain(warning);
    expect(res.message).toMatch(counts);
    expect(res.message).toContain(warning);
  });

  it('warns when an old env image ignored sync-wins and overwrote shared keys', async () => {
    envSyncExecute.mockResolvedValue({ ok: true });
    overlayRun.mockResolvedValue({ ok: true, applied: ['itad_api_key', ...ALWAYS_SEEDED] });
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(cap.details.settings_overlay).toMatch(/sync-wins NOT honoured/);
    expect(res.message).toMatch(/sync-wins NOT honoured/);
  });

  it('an old VM orchestrator that rejects --sync-wins still gets the slot identity, and says so', async () => {
    // rl-infra/deploy.sh not yet run since the flag landed: without the retry
    // the overlay fails, the env boots on the laptop's shared bot token
    // (ROK-1469 D1) and the deploy message just says "laptop sync".
    envSyncExecute.mockResolvedValue({ ok: true });
    oldOrchestrator(['itad_api_key', ...ALWAYS_SEEDED]);
    const { runSettingsOverlay } = await realOverlay();
    overlayRun.mockImplementation(runSettingsOverlay);
    const { ctx, cap } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(remoteCommands().filter((c) => c.startsWith(OVERLAY_BIN))).toEqual([
      `${OVERLAY_BIN} --slug demo --sync-wins`,
      `${OVERLAY_BIN} --slug demo`,
    ]);
    expect(cap.steps).toContainEqual({ name: 'settings_overlay', ok: true });
    expect(res.ok).toBe(true);
    expect(res.message).toContain(SYNC_WINS_NOT_HONOURED);
    expect(res.message).toContain('./rl-infra/deploy.sh');
  });

  it('names a failed overlay on a GREEN deploy: the slot identity was not applied', async () => {
    envSyncExecute.mockResolvedValue({ ok: true });
    overlayRun.mockResolvedValue({ ok: false, applied: [], error: 'settings_overlay_failed', message: 'ssh: timeout' });
    const { ctx } = makeCtx();
    const res = await runDeployChain(PARAMS as never, ctx);
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/settings_overlay FAILED/);
    expect(res.message).toMatch(/slot Discord identity was NOT applied/);
  });
});

describe('runSettingsOverlay — remote command', () => {
  it('appends --sync-wins only when asked (the flag, never a value)', async () => {
    const real = await realOverlay();
    await real.runSettingsOverlay('demo', { syncWins: true });
    await real.runSettingsOverlay('demo');
    expect(remoteCommands()).toEqual([
      `${OVERLAY_BIN} --slug demo --sync-wins`,
      `${OVERLAY_BIN} --slug demo`,
    ]);
  });

  it('retries WITHOUT the flag when the VM orchestrator rejects it, marked not honoured', async () => {
    oldOrchestrator(['itad_api_key', ...ALWAYS_SEEDED]);
    const real = await realOverlay();
    const ov = await real.runSettingsOverlay('demo', { syncWins: true });
    expect(remoteCommands()).toEqual([`${OVERLAY_BIN} --slug demo --sync-wins`, `${OVERLAY_BIN} --slug demo`]);
    expect(ov).toMatchObject({ ok: true, sync_wins: false, orchestrator_outdated: true });
    expect(ov.applied).toContain('discord_bot_token');
    expect(real.overlayIgnoredSyncWins(ov, true)).toBe(true);
  });

  it('does not retry any other overlay failure', async () => {
    childExec.mockRejectedValue(Object.assign(new Error('Command failed: ssh'), { stderr: 'env not found: demo' }));
    const real = await realOverlay();
    const ov = await real.runSettingsOverlay('demo', { syncWins: true });
    expect(remoteCommands()).toEqual([`${OVERLAY_BIN} --slug demo --sync-wins`]);
    expect(ov).toMatchObject({ ok: false, applied: [], message: 'env not found: demo' });
  });
});
