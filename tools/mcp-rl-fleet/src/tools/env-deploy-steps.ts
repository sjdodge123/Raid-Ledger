// ROK-1362 — rl_env_deploy chain steps, extracted from env-deploy.ts so the
// tool wrapper stays an async-dispatch shell. runDeployChain runs INSIDE the
// detached laptop runner (runner-entry.ts): it is allowed to block as long as
// needed (it is not holding the MCP channel), and reports each step through the
// ChainCtx, which mutates the laptop task JSON so rl_task_status shows progress.

import * as claim from './claim.js';
import * as buildImage from './env-build-image.js';
import * as envSpin from './env-spin.js';
import * as envSync from './env-sync.js';
import * as task from './task.js';
import { runCloneCore } from './env-clone-prod.js';
import { countSharedKeys, runSettingsOverlay } from './env-settings-overlay.js';
import { buildSshArgs } from '../exec.js';
import { isStillRunning, type ExecuteStatusReturn } from './task-schemas.js';
import type { EnvDeployParams } from './env-deploy.js';

export interface ChainCtx {
  /** Update the in-progress step label (narrated by rl_task_status). */
  setCurrent(step: string): void;
  /** Append a completed step (PASS/FAIL) with its duration. */
  recordStep(name: string, ok: boolean, tookS: number, detail?: string, error?: string): void;
}

export interface DeployChainResult {
  ok: boolean;
  url?: string;
  internal_url?: string;
  slot_url?: string | null;
  admin_email?: string;
  /** A3-B P4: internal chain field only. It is written to the 0600 laptop task
   *  JSON and withheld again at every MCP read boundary (local-task.ts). */
  admin_password?: string | null;
  slot?: number | null;
  expected_head?: string | null;
  synced_head?: string | null;
  error?: string;
  failed_step?: string;
  message: string;
}

const now = (): number => Date.now() / 1000;

/** Loop executeWait(120s) until the VM task is terminal, narrating progress each
 *  slice. Bounded by the build's own watchdog (task-start --timeout-seconds) plus
 *  a slice guard so a wedged poll can't spin forever. */
async function pollVmTask(
  taskId: string,
  ctx: ChainCtx,
  label: string,
  timeoutS: number,
): Promise<ExecuteStatusReturn> {
  const maxSlices = Math.ceil(timeoutS / 120) + 2;
  for (let i = 0; i < maxSlices; i++) {
    const r = await task.executeWait({ task_id: taskId, timeout_seconds: 120 });
    if (isStillRunning(r)) {
      ctx.setCurrent(r.current_step ?? `${label}…`);
      continue;
    }
    return r as ExecuteStatusReturn;
  }
  return { ok: false, error: 'poll_exhausted', task_id: taskId, steps: [] };
}

async function stepBuild(
  params: EnvDeployParams,
  ctx: ChainCtx,
): Promise<{ ok: boolean; expected_head?: string | null; synced_head?: string | null; error?: string; message?: string }> {
  const t = now();
  ctx.setCurrent('building image from /workspace');
  const bi = await buildImage.execute({
    tag: params.slug,
    worktree_path: params.worktree_path,
    timeout_seconds: params.timeout_seconds,
    wait: false,
  });
  // wait:false never yields a still_running snapshot — this narrows the union
  // (and is a safe guard if that ever changes).
  if (isStillRunning(bi)) {
    ctx.recordStep('build_image', false, now() - t, undefined, 'unexpected still_running on async dispatch');
    return { ok: false, error: 'build_dispatch_failed', message: 'unexpected still_running on build dispatch' };
  }
  if (!bi.ok || !bi.task_id) {
    const syncFailed = bi.error === 'sync_stuck' || bi.error === 'probe_failed';
    ctx.recordStep(syncFailed ? 'sync_guard' : 'build_image', false, now() - t, undefined, bi.error || bi.stderr);
    return { ok: false, expected_head: bi.expected_head, synced_head: bi.synced_head, error: bi.error ?? 'build_dispatch_failed', message: bi.stderr || 'build dispatch failed' };
  }
  const term = await pollVmTask(bi.task_id, ctx, 'docker build', params.timeout_seconds ?? 1800);
  if (term.mcp_runtime_status !== 'succeeded') {
    ctx.recordStep('build_image', false, now() - t, bi.task_id, term.message || term.error || term.mcp_runtime_status);
    return { ok: false, expected_head: bi.expected_head, synced_head: bi.synced_head, error: 'build_image_failed', message: term.message || `build task ${bi.task_id} ended ${term.mcp_runtime_status}` };
  }
  ctx.recordStep('build_image', true, now() - t, bi.task_id);
  return { ok: true, expected_head: bi.expected_head, synced_head: bi.synced_head };
}

async function restartAllinone(slug: string): Promise<void> {
  const sshArgs = await buildSshArgs(
    `DOCKER_HOST=tcp://127.0.0.1:2375 docker restart rl-env-${slug}-allinone && sleep 6`,
  );
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await promisify(execFile)('ssh', sshArgs, { timeout: 60_000 });
}

export async function runDeployChain(
  params: EnvDeployParams,
  ctx: ChainCtx,
): Promise<DeployChainResult> {
  // 1. Claim a slot.
  let t = now();
  ctx.setCurrent('claiming runner slot');
  const cl = await claim.execute({ branch: params.branch, worktree_path: params.worktree_path });
  if (!cl.ok || (cl as { queued?: boolean }).queued) {
    ctx.recordStep('claim', false, now() - t, undefined, (cl as { error?: string }).error || 'claim failed/queued');
    return { ok: false, failed_step: 'claim', error: 'claim_failed', message: 'claim step failed or returned queued — try again after a slot frees up' };
  }
  ctx.recordStep('claim', true, now() - t, `slot ${cl.slot}`);
  const slot = typeof cl.slot === 'number' ? cl.slot : null;

  // 2. Build image from /workspace (async dispatch + poll inside this runner).
  let expectedHead: string | null | undefined;
  let syncedHead: string | null | undefined;
  if (!params.skip_build) {
    const b = await stepBuild(params, ctx);
    expectedHead = b.expected_head;
    syncedHead = b.synced_head;
    if (!b.ok) {
      return { ok: false, slot, failed_step: b.error === 'sync_stuck' ? 'sync_guard' : 'build_image', error: b.error, expected_head: expectedHead, synced_head: syncedHead, message: b.message ?? 'build failed' };
    }
  } else {
    ctx.recordStep('build_image', true, 0, 'skipped');
  }

  // 3. Spin env with the per-branch image.
  t = now();
  ctx.setCurrent('spinning env');
  // A3-B P4: include_credentials:true is CORRECT here and is not a context
  // leak. runDeployChain executes inside the detached laptop runner, whose
  // only output sink is the 0600 task JSON — not an agent transcript. The
  // password has to reach that file for rl_task_status({include_credentials:
  // true}) to have anything to hand back later; the withholding happens when
  // that file is READ, in local-task.ts.
  const sp = await envSpin.execute({
    slug: params.slug,
    image: `registry.rl.lan:5000/rl-allinone:${params.slug}`,
    worktree_path: params.worktree_path,
    include_credentials: true,
  });
  if (!sp.ok) {
    ctx.recordStep('env_spin', false, now() - t, undefined, sp.error || sp.message);
    return { ok: false, slot, failed_step: 'env_spin', error: 'env_spin_failed', message: `env_spin failed: ${sp.error || sp.message}${sp.hint ? ` — ${sp.hint}` : ''}` };
  }
  ctx.recordStep('env_spin', true, now() - t, sp.url || '');

  // 4. Sync app_settings.
  let syncedSettings = false;
  let syncFailureDetail: string | undefined;
  if (!params.skip_sync) {
    t = now();
    ctx.setCurrent('syncing app_settings');
    const sy = await envSync.execute({ slug: params.slug, mode: 'settings' });
    if (!sy.ok) {
      syncFailureDetail = sy.stderr || 'sync_settings step failed';
      ctx.recordStep('sync_settings', false, now() - t, undefined, syncFailureDetail);
    } else {
      ctx.recordStep('sync_settings', true, now() - t);
      syncedSettings = true;
    }
  } else {
    ctx.recordStep('sync_settings', true, 0, 'skipped');
  }

  // 5. Optional: clone prod data into the env. MUST run BEFORE the overlay:
  // runCloneCore shells out to sync-local-to-env.sh, which rewrites
  // app_settings from the laptop and would otherwise wipe the slot identity
  // the overlay just wrote (Codex #1).
  let cloneFailed = false;
  let cloneFailureDetail: string | undefined;
  if (params.clone_prod) {
    t = now();
    ctx.setCurrent('cloning prod data');
    const cp = await runCloneCore({ slug: params.slug, skip_local_refresh: params.clone_prod_skip_local_refresh });
    if (!cp.ok) {
      cloneFailureDetail = cp.stderr || 'clone failed';
      ctx.recordStep('clone_prod', false, now() - t, undefined, cloneFailureDetail);
      cloneFailed = true;
    } else {
      ctx.recordStep('clone_prod', true, now() - t, cp.restarted_for_settings ? 'restarted' : 'no-restart');
    }
  }

  // 6. ROK-1469: stamp the SLOT's Discord identity + the VM-side shared-key
  // bundle over whatever sync_settings (and clone_prod) just copied. Runs even
  // when the sync FAILED — the bundle is the laptop-independent path (Docker
  // Desktop off).
  let overlaySharedKeys = 0;
  let overlayApplied = 0;
  let overlayBundleWarning: string | null = null;
  if (!params.skip_sync) {
    t = now();
    ctx.setCurrent('applying slot identity + settings bundle');
    const ov = await runSettingsOverlay(params.slug);
    overlayApplied = ov.applied.length;
    overlaySharedKeys = countSharedKeys(ov.applied);
    overlayBundleWarning = ov.bundle_warning ?? null;
    ctx.recordStep(
      'settings_overlay',
      ov.ok,
      now() - t,
      ov.ok ? `${overlayApplied} key(s), ${overlaySharedKeys} shared` : undefined,
      ov.ok ? undefined : (ov.error ?? ov.message),
    );
  }

  // 7. Restart the allinone so SettingsService re-reads the new rows. Last,
  // so it picks up the clone AND the overlay.
  if (syncedSettings || overlayApplied > 0) {
    t = now();
    ctx.setCurrent('restarting for settings');
    try {
      await restartAllinone(params.slug);
      ctx.recordStep('restart_for_settings', true, now() - t);
    } catch (err) {
      const e = err as Error & { stderr?: string };
      ctx.recordStep('restart_for_settings', false, now() - t, undefined, e.stderr || e.message);
    }
  }

  // A failed sync is only fatal when nothing seeded the env's SHARED keys.
  // The slot identity is written on every overlay, so counting it would report
  // a green deploy for an env with no ITAD/Blizzard/LLM credentials (Codex #2).
  const settingsFailed = !params.skip_sync && !syncedSettings && overlaySharedKeys === 0;
  const base = {
    slot,
    url: sp.url,
    internal_url: sp.internal_url,
    slot_url: sp.slot_url ?? null,
    admin_email: sp.admin_email,
    admin_password: sp.admin_password ?? null,
    expected_head: expectedHead,
    synced_head: syncedHead,
  };
  if (settingsFailed) {
    return { ...base, ok: false, failed_step: 'sync_settings', error: 'sync_settings_failed', message: `FAILED: sync_settings did not succeed (${syncFailureDetail ?? 'unknown'}) and the VM bundle seeded NO shared API keys${overlayBundleWarning ? ` (${overlayBundleWarning})` : ''}. Container up at ${sp.url}${overlayApplied > 0 ? ' with its slot Discord identity' : ''} but NO shared credentials (ITAD/Blizzard/IGDB/LLM) — start Docker Desktop and re-run rl_env_deploy, or refresh the bundle with RL_OPERATOR=1 rl settings push.` };
  }
  if (cloneFailed) {
    return { ...base, ok: false, failed_step: 'clone_prod', error: 'clone_prod_failed', message: `FAILED: clone_prod did not succeed (${cloneFailureDetail ?? 'unknown'}). Container up at ${sp.url} with synced settings but prod data NOT loaded.` };
  }
  const settingsSource = syncedSettings
    ? `${overlayApplied > 0 ? 'laptop sync + slot identity/bundle overlay' : 'laptop sync'}`
    : 'VM settings bundle overlay (laptop DB unavailable)';
  return { ...base, ok: true, message: `Settings: ${settingsSource}. Deployed branch to ${sp.url}. Share this URL with testers for ALL purposes (general testing AND Discord login). Admin login: ${sp.admin_email} — the password is withheld from tool output by default (A3-B P4); re-read this task with rl_task_status({task_id, include_credentials: true}) only if you must authenticate as admin@local yourself.` };
}
