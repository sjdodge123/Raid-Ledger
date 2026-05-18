// rl_env_deploy — end-to-end "deploy this branch to a test env" workflow.
//
// Chains the existing primitives: claim → build image from branch →
// spin env using that image → sync operator's settings → return URL.
// The agent gets a shareable URL in ONE tool call.

import * as claim from './claim.js';
import * as buildImage from './env-build-image.js';
import * as envSpin from './env-spin.js';
import * as envSync from './env-sync.js';

export const TOOL_NAME = 'rl_env_deploy';
export const TOOL_DESCRIPTION =
  "Single-call branch deployment: claim a runner slot, build the allinone image from the agent's CURRENT BRANCH (Mutagen-synced /workspace), push to the local registry tagged with the slug, spin a per-test env using that image, then sync operator's app_settings (API keys, OAuth configs) so the env has working integrations. Returns the external URL the agent should share with testers. This is the right tool when an agent needs to show realistic prod-like preview of in-flight branch work. Idempotent on the slug — re-running rebuilds the image from current /workspace and re-deploys.";

export interface EnvDeployParams {
  /** Env slug — also used as the image tag. [a-z0-9-]+. */
  slug: string;
  /** Branch label recorded on the claim. Auto-detected from cwd if absent. */
  branch?: string;
  /** Skip the app_settings sync step (faster, but env starts empty). */
  skip_sync?: boolean;
  /** Skip rebuild — use a previously-built image with this slug as tag. */
  skip_build?: boolean;
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
  const cl = await claim.execute({ branch: params.branch });
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
    const bi = await buildImage.execute({ tag: params.slug, timeout_seconds: params.timeout_seconds });
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

  // 4. Sync app_settings (Discord/Blizzard/ITAD keys + admin creds).
  if (!params.skip_sync) {
    t = now();
    const sy = await envSync.execute({ slug: params.slug, mode: 'settings' });
    if (!sy.ok) {
      log('sync_settings', false, t, undefined, sy.error || sy.stderr);
      // Non-fatal — env is usable, just without operator's keys.
    } else {
      log('sync_settings', true, t);
    }
  } else {
    log('sync_settings', true, t, 'skipped');
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
