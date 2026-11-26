/**
 * ROK-1676 (RH-6, L1) — which relay hub URL this instance talks to.
 *
 * Precedence: `RELAY_HUB_URL` env > `relay_url` setting > built-in default.
 * The env value is read, never written into the setting, so removing it
 * falls straight back to the setting.
 */

/** Built-in hub URL (placeholder until the public hub has DNS — D9). */
export const DEFAULT_RELAY_URL = 'https://hub.raid-ledger.com';

/** `RELAY_HUB_URL` after validation. */
export type RelayHubEnv =
  | { kind: 'unset' }
  | { kind: 'invalid'; raw: string }
  | { kind: 'valid'; url: string };

/** Parse `RELAY_HUB_URL`: trimmed, `http(s)://` only, trailing `/` stripped. */
export function parseRelayHubEnv(raw: string | undefined): RelayHubEnv {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return { kind: 'unset' };
  try {
    const { protocol } = new URL(trimmed);
    if (protocol !== 'http:' && protocol !== 'https:') {
      return { kind: 'invalid', raw: trimmed };
    }
  } catch {
    return { kind: 'invalid', raw: trimmed };
  }
  return { kind: 'valid', url: trimmed.replace(/\/+$/, '') };
}

/** The effective hub URL: valid env, else the setting, else the default. */
export function resolveRelayUrl(
  env: RelayHubEnv,
  setting: string | null,
): string {
  if (env.kind === 'valid') return env.url;
  return setting || DEFAULT_RELAY_URL;
}
