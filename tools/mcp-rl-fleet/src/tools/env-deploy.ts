// rl_env_deploy — end-to-end "deploy this branch to a test env" workflow.
//
// Chains the existing primitives: claim → build image from branch →
// spin env using that image → sync operator's settings → return URL.
// The agent gets a shareable URL in ONE tool call.

import * as claim from './claim.js';
import * as buildImage from './env-build-image.js';
import * as envSpin from './env-spin.js';
import * as envSync from './env-sync.js';
import * as envCloneProd from './env-clone-prod.js';

export const TOOL_NAME = 'rl_env_deploy';
export const TOOL_DESCRIPTION =
  "Single-call branch deployment: claim a runner slot, build the allinone image from the agent's CURRENT BRANCH (Mutagen-synced /workspace), push to the local registry tagged with the slug, spin a per-test env using that image, then sync operator's app_settings (API keys, OAuth configs) so the env has working integrations. Returns the external URL the agent should share with testers. Pass clone_prod=true to ALSO pipe sanitized prod data into the env (after the settings sync — useful when testers need prod-shaped rows to reproduce a bug). Idempotent on the slug — re-running rebuilds the image from current /workspace and re-deploys.";

export interface EnvDeployParams {
  /** Env slug — also used as the image tag. [a-z0-9-]+. */
  slug: string;
  /** Branch label recorded on the claim. Auto-detected from cwd if absent. */
  branch?: string;
  /**
   * Absolute path to the agent's worktree. CRITICAL when calling from a
   * git worktree — without it, the MCP server uses its own cwd (where
   * Claude was started, usually the main repo) and (a) Mutagen syncs the
   * WRONG branch's files, (b) the build sees stale code, (c) agent_id
   * doesn't match the claimed slot.
   */
  worktree_path?: string;
  /** Skip the app_settings sync step (faster, but env starts empty). */
  skip_sync?: boolean;
  /** Skip rebuild — use a previously-built image with this slug as tag. */
  skip_build?: boolean;
  /** Also clone sanitized prod data into the env after the settings sync. */
  clone_prod?: boolean;
  /** When clone_prod=true, skip the prod→local refresh step (faster). */
  clone_prod_skip_local_refresh?: boolean;
  /** Soft timeout. Defaults to 1800 (30 min) for the full chain. */
  timeout_seconds?: number;
}

export interface EnvDeployResult {
  ok: boolean;
  slug: string;
  /** External (canonical, shareable) URL — what to send testers. */
  url?: string;
  /** LAN URL — operator-facing fallback. */
  internal_url?: string;
  steps: Record<string, { ok: boolean; took_s?: number; detail?: string; error?: string }>;
  message: string;
}

const now = () => Date.now() / 1000;

export async function execute(params: EnvDeployParams): Promise<EnvDeployResult> {
  const steps: EnvDeployResult['steps'] = {};
  const log = (k: string, ok: boolean, t: number, detail?: string, error?: string) => {
    steps[k] = { ok, took_s: Math.round((now() - t) * 10) / 10, detail, error };
  };

  // 1. Claim a slot (idempotent — returns the same slot if agent already holds one).
  let t = now();
  const cl = await claim.execute({ branch: params.branch, worktree_path: params.worktree_path });
  if (!cl.ok || (cl as { queued?: boolean }).queued) {
    log('claim', false, t, undefined, (cl as { message?: string; error?: string }).message || (cl as { error?: string }).error || 'claim failed/queued');
    return {
      ok: false,
      slug: params.slug,
      steps,
      message: 'claim step failed or returned queued — try again after a slot frees up',
    };
  }
  log('claim', true, t, `slot ${cl.slot}`);

  // 2. Build image from /workspace (the agent's branch).
  if (!params.skip_build) {
    t = now();
    const bi = await buildImage.execute({
      tag: params.slug,
      worktree_path: params.worktree_path,
      timeout_seconds: params.timeout_seconds,
    });
    if (!bi.ok) {
      log('build_image', false, t, undefined, bi.error || bi.stderr || 'build failed');
      return {
        ok: false,
        slug: params.slug,
        steps,
        message: `build_image step failed: ${bi.error || bi.stderr || 'unknown'}`,
      };
    }
    log('build_image', true, t, `${bi.image} (${bi.duration_s}s)`);
  } else {
    log('build_image', true, t, 'skipped');
  }

  // 3. Spin env with the per-branch image.
  t = now();
  const sp = await envSpin.execute({
    slug: params.slug,
    image: `registry.rl.lan:5000/rl-allinone:${params.slug}`,
    worktree_path: params.worktree_path,
  });
  if (!sp.ok) {
    log('env_spin', false, t, undefined, sp.error || sp.message);
    return {
      ok: false,
      slug: params.slug,
      steps,
      message: `env_spin failed: ${sp.error || sp.message}`,
    };
  }
  log('env_spin', true, t, sp.url || '');

  // 4. Sync app_settings (Discord/Blizzard/ITAD keys).
  let syncedSettings = false;
  if (!params.skip_sync) {
    t = now();
    const sy = await envSync.execute({ slug: params.slug, mode: 'settings' });
    if (!sy.ok) {
      log('sync_settings', false, t, undefined, sy.error || sy.stderr);
      // Non-fatal — env is usable, just without operator's keys.
    } else {
      log('sync_settings', true, t);
      syncedSettings = true;
    }
  } else {
    log('sync_settings', true, t, 'skipped');
  }

  // 5. If we just synced settings, restart the allinone container so its
  // SettingsService re-reads + re-caches the new (decryptable) rows.
  // The boot-time cache otherwise stays empty for 30 min — agents would
  // see "Discord not configured" even though the rows are in the DB.
  if (syncedSettings) {
    t = now();
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const sshUser = process.env.RL_PROXMOX_USER ?? 'rl-agent';
    const sshHost = process.env.RL_PROXMOX_HOST ?? 'rl-infra';
    try {
      // rl-agent has no docker group membership (intentional — see the
      // hardening commit). docker CLI must go through the path-filtered
      // wollomatic proxy at 127.0.0.1:2375 instead of /var/run/docker.sock.
      // The proxy allowlist permits POST /containers/rl-env-*/restart, so
      // this works once DOCKER_HOST points at the proxy. Without it, the
      // CLI tries the unix socket and gets "permission denied" (Bug G).
      await execFileAsync(
        'ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser}@${sshHost}`,
         `DOCKER_HOST=tcp://127.0.0.1:2375 docker restart rl-env-${params.slug}-allinone && sleep 6`],
        { timeout: 60_000 },
      );
      log('restart_for_settings', true, t);
    } catch (err) {
      const e = err as Error & { stderr?: string };
      log('restart_for_settings', false, t, undefined, e.stderr || e.message);
    }
  }

  // 6. Optional: clone prod data into the env on top of the synced settings.
  // The clone tool itself restarts the allinone, so we'd be double-restarting
  // if step 5 already ran — that's fine (restart is idempotent + cheap).
  if (params.clone_prod) {
    t = now();
    const cp = await envCloneProd.execute({
      slug: params.slug,
      skip_local_refresh: params.clone_prod_skip_local_refresh,
    });
    if (!cp.ok) {
      log('clone_prod', false, t, undefined, cp.stderr || 'clone failed');
      // Non-fatal — env still usable with just synced settings.
    } else {
      log('clone_prod', true, t, cp.restarted_for_settings ? 'restarted' : 'no-restart');
    }
  }

  return {
    ok: true,
    slug: params.slug,
    url: sp.url,
    internal_url: sp.internal_url,
    steps,
    message: `Deployed branch to ${sp.url}. Share this URL with testers.`,
  };
}
