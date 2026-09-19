/**
 * ROK-1627: trusted-anchor resolution for `process.env.CLIENT_URL`.
 *
 * `CLIENT_URL` builds the Discord/Steam auth-success redirect and every link
 * in a bot embed or DM, so it must never be derived from a request — a forged
 * `Host` header would hand a later login's auth code to the attacker. These
 * helpers read only deployer-controlled anchors and return `undefined` when
 * none of them is trustworthy; a guessed default is worse than no link.
 */

/** True when a config value is absent or blank (`ENV CLIENT_URL=` counts). */
export function isUnset(value: string | null | undefined): boolean {
  return !value || value.trim() === '';
}

/** The only schemes a browser-facing client URL may use. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parse a value as an http(s) URL. Any other scheme is rejected: schemes
 * outside the allowlist have an opaque origin, whose `origin` is the literal
 * string `'null'`, and none of them is a usable site address.
 */
function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Origin of an http(s) URL, or `undefined` when it is not one. */
export function originOf(value: string | null | undefined): string | undefined {
  if (isUnset(value)) return undefined;
  return parseHttpUrl(value!.trim())?.origin;
}

/** An http(s) client URL with any trailing slash removed. */
function normalizeClientUrl(
  value: string | null | undefined,
): string | undefined {
  if (isUnset(value)) return undefined;
  const trimmed = value!.trim();
  if (!parseHttpUrl(trimmed)) return undefined;
  return trimmed.replace(/\/+$/, '');
}

/** The deployer-controlled sources `CLIENT_URL` may be seeded from. */
export interface ClientUrlAnchors {
  /** `app_settings.client_url` — set by the operator, highest trust. */
  settingClientUrl: string | null;
  /** `app_settings.discord_callback_url` — origin only. */
  settingDiscordCallbackUrl: string | null;
  /** The `DISCORD_CALLBACK_URL` env var — origin only. */
  envDiscordCallbackUrl: string | undefined;
}

/**
 * Resolve the client URL from trusted anchors, in descending trust order.
 * Returns `undefined` when nothing parses — never a localhost default.
 */
export function resolveSeedClientUrl(
  anchors: ClientUrlAnchors,
): string | undefined {
  return (
    normalizeClientUrl(anchors.settingClientUrl) ??
    originOf(anchors.settingDiscordCallbackUrl) ??
    originOf(anchors.envDiscordCallbackUrl)
  );
}
