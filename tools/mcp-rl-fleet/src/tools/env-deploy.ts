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
  "Single-call branch deployment: claim a runner slot, build the allinone image from the agent's CURRENT BRANCH (Mutagen-synced /workspace), push to the local registry tagged with the slug, spin a per-test env using that image, then sync operator's app_settings (API keys, OAuth configs) so the env has working integrations. Returns the external URL the agent should share with testers. Pass clone_prod=true to ALSO pipe sanitized prod data into the env (after the settings sync — useful when testers need prod-shaped rows to reproduce a bug). Idempotent on the slug — re-running rebuilds the image from current /workspace and re-deploys. NOTE: this tool is SYNC (returns when the full chain completes). It does NOT accept the wait / wait_timeout_seconds params that rl_validate_ci / rl_env_build_image_from_runner / rl_env_clone_prod expose. For parallel deployments, fan out via the individual primitives (rl_env_build_image_from_runner + rl_env_spin + rl_env_sync_from_local) with wait:false and orchestrate via rl_task_wait.";

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
  /**
   * Canonical/shareable URL — ALWAYS use this for tester links, test
   * plan deep-links, Chrome MCP navigation, etc. Slot-form when
   * RL_PUBLIC_DOMAIN is set (https://slot-N.{RL_PUBLIC_DOMAIN}) —
   * supports Discord OAuth + routes to the env.
   */
  url?: string;
  /** LAN URL — operator-facing fallback. */
  internal_url?: string;
  /**
   * Same as `url` when public. Kept as a separate field for callers
   * that explicitly need the slot-form. Most code just uses `url`.
   */
  slot_url?: string | null;
  /** Admin email (always admin@local in DEMO_MODE envs). */
  admin_email?: string;
  /**
   * Admin password seeded into the env by env-spin. Use to authenticate
   * against /api/auth/local. Stable across deploys when RL_ADMIN_PASSWORD
   * is set in /srv/rl-infra/.env; random per-call otherwise.
   */
  admin_password?: string | null;
  steps: Record<string, { ok: boolean; took_s?: number; detail?: string; error?: string }>;
  /** Set when top-level ok=false. Short machine-readable code: "sync_settings_failed" | "clone_prod_failed". */
  error?: string;
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
    // env-deploy is the SYNC wrapper — inner buildImage is now async-by-
    // default per ROK-1331 M2, so we explicitly pass wait:true to preserve
    // the chained step-log behavior the deploy flow depends on.
    const bi = await buildImage.execute({
      tag: params.slug,
      worktree_path: params.worktree_path,
      timeout_seconds: params.timeout_seconds,
      wait: true,
      wait_timeout_seconds: params.timeout_seconds,
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
    // ROK-1338 PR-1 (2026-05-21): forward env-spin's diagnostic envelope
    // through the step's `detail`. Without this, env-spin's `phase` /
    // `exit_code` / `hint` fields are dropped at the env-deploy boundary
    // and the caller sees only the bare error code (e.g.
    // `env_spin_aborted_unexpectedly` with no clue what to investigate).
    // Build a compact one-line detail so the dashboard fleet card can show
    // it; full structured object still parseable from the JSON-stringified
    // form if the caller needs every field.
    const diag: Record<string, unknown> = {};
    if (sp.phase) diag.phase = sp.phase;
    if (sp.exit_code !== undefined) diag.exit_code = sp.exit_code;
    if (sp.hint) diag.hint = sp.hint;
    if (sp.message) diag.message = sp.message;
    const detail = Object.keys(diag).length > 0 ? JSON.stringify(diag) : undefined;
    log('env_spin', false, t, detail, sp.error || sp.message);
    return {
      ok: false,
      slug: params.slug,
      steps,
      message: `env_spin failed: ${sp.error || sp.message}${sp.hint ? ` — ${sp.hint}` : ''}`,
    };
  }
  log('env_spin', true, t, sp.url || '');

  // 4. Sync app_settings (Discord/Blizzard/ITAD keys + admin password).
  let syncedSettings = false;
  let syncFailureDetail: string | undefined;
  if (!params.skip_sync) {
    t = now();
    const sy = await envSync.execute({ slug: params.slug, mode: 'settings' });
    if (!sy.ok) {
      syncFailureDetail = sy.stderr || 'sync_settings step failed';
      log('sync_settings', false, t, undefined, syncFailureDetail);
      // Was framed as "non-fatal" — but without settings the env has no
      // Discord/ITAD/IGDB credentials AND no admin@local password seeded,
      // which means most flows can't run. Propagate as a top-level
      // failure (operator pref 2026-05-19) instead of misleading ok=true.
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
  let cloneFailed = false;
  let cloneFailureDetail: string | undefined;
  if (params.clone_prod) {
    t = now();
    const cp = await envCloneProd.execute({
      slug: params.slug,
      skip_local_refresh: params.clone_prod_skip_local_refresh,
    });
    if (!cp.ok) {
      cloneFailureDetail = cp.stderr || 'clone failed';
      log('clone_prod', false, t, undefined, cloneFailureDetail);
      // Treat as FATAL when caller explicitly opted in via clone_prod=true.
      // Same shape as sync_settings (M-MCP-1, operator pref 2026-05-19):
      // opt-in IS consent — testers expect prod-shaped rows, silent
      // non-fatal logging makes them chase phantom bugs against an env
      // that has settings but no prod data. Propagate as top-level failure.
      cloneFailed = true;
    } else {
      log('clone_prod', true, t, cp.restarted_for_settings ? 'restarted' : 'no-restart');
    }
  }

  const settingsFailed = !params.skip_sync && !syncedSettings;
  const overallFailed = settingsFailed || cloneFailed;
  const baseMsg = `Deployed branch to ${sp.url}. Share this URL with testers for ALL purposes (general testing AND Discord login). Admin login: ${sp.admin_email} / (password in admin_password field).`;
  let message: string;
  let errorCode: string | undefined;
  if (settingsFailed) {
    message = `FAILED: sync_settings step did not succeed (${syncFailureDetail ?? 'unknown error'}). The container is up at ${sp.url} but has NO Discord/IGDB/ITAD credentials AND admin@local was NOT seeded — most flows will fail. Re-run rl_env_deploy or call rl_env_sync_from_local directly to recover. Admin email would be ${sp.admin_email}.`;
    errorCode = 'sync_settings_failed';
  } else if (cloneFailed) {
    message = `FAILED: clone_prod step did not succeed (${cloneFailureDetail ?? 'unknown error'}). The container is up at ${sp.url} with synced settings, but prod-shaped data was NOT loaded. Tester-visible rows will be empty/default. Re-run rl_env_deploy with clone_prod=true (and clone_prod_skip_local_refresh=true if local DB is already fresh), or call rl_env_clone_prod directly to recover. Admin login: ${sp.admin_email} / (password in admin_password field).`;
    errorCode = 'clone_prod_failed';
  } else {
    message = baseMsg;
  }

  // HO-2 (ROK-1326): surface env-spin bootstrap_warnings into the human
  // message. They're non-fatal (the container is healthy) but they cause
  // admin_password to come back null + login to require DEMO_MODE bypass.
  // Agents reading just the message field shouldn't have to also crawl
  // steps.env_spin.detail to know what went sideways.
  const warnings = sp.bootstrap_warnings ?? [];
  if (warnings.length > 0) {
    const summary = warnings.map((w) => `${w.code}: ${w.detail}`).join('; ');
    message = `${message} Bootstrap warnings: ${summary}`;
  }
  // HO-8 (ROK-1326): when this env doesn't own the slot Host rule, Discord
  // OAuth callbacks land on the OTHER env. Tell the agent so they pick
  // the right URL pattern + login flow.
  if (sp.slot_oauth_available === false) {
    message = `${message} Discord OAuth not available on this env — another env owns the slot rule. Use the per-slug URL OR DEMO_MODE bypass for login.`;
  }

  return {
    ok: !overallFailed,
    slug: params.slug,
    url: sp.url,
    internal_url: sp.internal_url,
    slot_url: sp.slot_url ?? null,
    admin_email: sp.admin_email,
    admin_password: sp.admin_password ?? null,
    steps,
    error: errorCode,
    message,
  };
}
