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
  error?: string;
  message?: string;
}

/**
 * app_settings keys the overlay ALWAYS writes when the slot has an identity.
 * They are not evidence that the env has usable API credentials, so callers
 * must not count them when deciding whether a failed sync was rescued.
 */
export const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  'discord_bot_token',
  'discord_bot_enabled',
  'discord_client_id',
  'discord_client_secret',
]);

/** Count applied keys that came from the SHARED bundle, not the slot identity. */
export function countSharedKeys(applied: string[]): number {
  return applied.filter((k) => !IDENTITY_KEYS.has(k)).length;
}

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Apply the slot identity + shared bundle to `slug`'s env.
 *
 * Never throws: a failed overlay must not abort an otherwise healthy deploy
 * (the env is still usable, just possibly on the operator's shared bot), so
 * callers get `{ ok: false, applied: [] }` and record it as a failed step.
 */
export async function runSettingsOverlay(
  slug: string,
): Promise<SettingsOverlayResult> {
  if (!SLUG_RE.test(slug)) {
    return { ok: false, applied: [], error: 'invalid_slug' };
  }
  const args = await buildSshArgs(
    `/srv/rl-infra/orchestrator/bin/env-settings-overlay --slug ${slug}`,
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
