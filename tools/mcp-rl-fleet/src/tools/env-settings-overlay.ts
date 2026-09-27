// ROK-1469 D6 — run the VM-side settings overlay for an env.
//
// The overlay stamps a fleet env with (a) its SLOT's Discord identity and
// (b) the shared API keys from /srv/rl-infra/settings/bundle.enc. It is the
// laptop-independent half of `rl_env_deploy`: sync_settings needs the
// operator's local DB container, the overlay needs only the VM.
//
// Thin SSH wrapper so the deploy chain can mock it — the orchestrator script
// (rl-infra/orchestrator/bin/env-settings-overlay) owns all the logic and is
// covered by its own shell spec.

import { buildSshArgs } from '../exec.js';

/** Key NAMES the overlay wrote — never values (the orchestrator emits names). */
export interface SettingsOverlayResult {
  ok: boolean;
  applied: string[];
  slot?: number | null;
  bot_identity?: unknown;
  /** Why the VM-side shared-key bundle contributed nothing (absent, wrong key, malformed). */
  bundle_warning?: string | null;
  /** Key NAMES an identity-only run left to the laptop sync. */
  skipped_keys?: string[];
  /** Whether the container honoured --identity-only (false: image predates it). */
  identity_only?: boolean;
  error?: string;
  message?: string;
}

/**
 * app_settings keys the VM overlay writes REGARDLESS of the shared bundle:
 * the slot's Discord identity (rl-infra/orchestrator/bin/_bot_identity.sh)
 * and the `demo_mode` flag, which bin/env-settings-overlay merges into every
 * payload since #1123. None is evidence that the env has usable API
 * credentials, so callers must not count them when deciding whether a failed
 * sync was rescued.
 *
 * KEEP IN SYNC with that script: any key it seeds unconditionally belongs
 * here. Missing `demo_mode` made every overlay look like it carried one
 * shared key, which silently disabled the ROK-1339 safety net from
 * 2026-09-09 until 2026-09-26.
 */
export const NON_CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  'discord_bot_token',
  'discord_bot_enabled',
  'discord_client_id',
  'discord_client_secret',
  'demo_mode',
]);

/** Count applied keys that came from the SHARED bundle (not always-seeded ones). */
export function countSharedKeys(applied: string[]): number {
  return applied.filter((k) => !NON_CREDENTIAL_KEYS.has(k)).length;
}

/** Shown when an identity-only overlay still wrote shared keys. */
export const IDENTITY_ONLY_NOT_HONOURED =
  'identity-only NOT honoured: the env image predates it, so the VM bundle overwrote the synced shared keys — rebuild the image';

/** Step detail for the deploy chain: counts and notes, never values. */
export function describeOverlayStep(ov: SettingsOverlayResult, identityOnly: boolean): string {
  const parts = [`${ov.applied.length} key(s), ${countSharedKeys(ov.applied)} shared`];
  if (identityOnly) {
    parts.push(`identity-only after a fresh sync, ${ov.skipped_keys?.length ?? 0} bundle key(s) skipped`);
    if (overlayIgnoredIdentityOnly(ov, identityOnly)) parts.push(IDENTITY_ONLY_NOT_HONOURED);
  }
  if (ov.bundle_warning) parts.push(`bundle warning: ${ov.bundle_warning}`);
  return parts.join('; ');
}

/** True when identity-only was asked for but shared keys were written anyway. */
export function overlayIgnoredIdentityOnly(ov: SettingsOverlayResult, identityOnly: boolean): boolean {
  return identityOnly && ov.ok && ov.identity_only !== true && countSharedKeys(ov.applied) > 0;
}

export interface RunOverlayOptions {
  /** Apply only the slot identity: a successful laptop sync wins for shared
   *  keys (operator ruling 2026-09-27). Omit after a failed/skipped sync. */
  identityOnly?: boolean;
}

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Apply the slot identity + shared bundle to `slug`'s env. With
 * `identityOnly`, the bundle's shared keys are skipped (reported in
 * `skipped_keys`) so they cannot overwrite what a fresh sync just copied.
 *
 * Never throws: a failed overlay must not abort an otherwise healthy deploy
 * (the env is still usable, just possibly on the operator's shared bot), so
 * callers get `{ ok: false, applied: [] }` and record it as a failed step.
 */
export async function runSettingsOverlay(
  slug: string,
  opts: RunOverlayOptions = {},
): Promise<SettingsOverlayResult> {
  if (!SLUG_RE.test(slug)) {
    return { ok: false, applied: [], error: 'invalid_slug' };
  }
  const flag = opts.identityOnly ? ' --identity-only' : '';
  const args = await buildSshArgs(
    `/srv/rl-infra/orchestrator/bin/env-settings-overlay --slug ${slug}${flag}`,
  );
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const { stdout } = await promisify(execFile)('ssh', args, { timeout: 120_000 });
    const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as SettingsOverlayResult;
    return { ...parsed, applied: parsed.applied ?? [] };
  } catch (err) {
    const e = err as Error & { stderr?: string };
    return {
      ok: false,
      applied: [],
      error: 'settings_overlay_failed',
      message: e.stderr || e.message,
    };
  }
}
