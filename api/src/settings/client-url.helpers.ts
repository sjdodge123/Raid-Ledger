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
  /** ROK-1697: `resolvePlatformPublicUrl(env)` — lowest trust. */
  platformPublicUrl: string | undefined;
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
    originOf(anchors.envDiscordCallbackUrl) ??
    normalizeClientUrl(anchors.platformPublicUrl)
  );
}

/**
 * ROK-1697: the public URL a hosting platform (or the deployer) declares in
 * the environment. Deployer-controlled env only — never a request header.
 */
export type PlatformEnv = Readonly<Record<string, string | undefined>>;

/** A resolved public URL and the env var that supplied it. */
export interface PlatformPublicUrl {
  url: string;
  source: string;
}

interface PlatformSource {
  name: string;
  /** What a usable value looks like — completes "Ignoring X=…: not …". */
  expected: string;
  /** The public origin the value names, or `undefined` when unusable. */
  toUrl: (value: string) => string | undefined;
}

/**
 * A bare `host[:port]` — no path, query, fragment, userinfo or whitespace.
 * An explicit `http(s)://` prefix is tolerated and kept.
 */
const BARE_HOST = /^(?:https?:\/\/)?[^\s/?#@:]+(?::\d+)?$/i;

/** A Fly.io app name: the label in front of `.fly.dev`. */
const FLY_APP_NAME = /^[a-z0-9-]+$/i;

/** Railway/Heroku publish a bare host; prefix `https://` unless a scheme is there. */
function hostOrigin(value: string): string | undefined {
  if (!BARE_HOST.test(value)) return undefined;
  return originOf(/^https?:\/\//i.test(value) ? value : `https://${value}`);
}

/** Fly publishes the app name; the public site is `https://<name>.fly.dev`. */
function flyOrigin(value: string): string | undefined {
  return FLY_APP_NAME.test(value)
    ? originOf(`https://${value}.fly.dev`)
    : undefined;
}

const URL_SOURCE = { expected: 'an http(s) URL', toUrl: originOf } as const;
const HOST_SOURCE = {
  expected: 'a bare host name',
  toUrl: hostOrigin,
} as const;

/**
 * Precedence order: the first usable source wins. Full-URL sources reduce to
 * their origin — a path would disagree with the callback-origin anchor, and
 * subpath deployments are not supported.
 */
const PLATFORM_SOURCES: readonly PlatformSource[] = [
  { name: 'PUBLIC_URL', ...URL_SOURCE },
  { name: 'RENDER_EXTERNAL_URL', ...URL_SOURCE },
  { name: 'RAILWAY_PUBLIC_DOMAIN', ...HOST_SOURCE },
  { name: 'FLY_APP_NAME', expected: 'a Fly app name', toUrl: flyOrigin },
  { name: 'APP_URL', ...URL_SOURCE },
  { name: 'HEROKU_APP_DEFAULT_DOMAIN_NAME', ...HOST_SOURCE },
];

/** Every env var the resolver reads, in precedence order. */
export const PLATFORM_PUBLIC_URL_VARS: readonly string[] = PLATFORM_SOURCES.map(
  (source) => source.name,
);

/**
 * Resolve the public URL from deployer-controlled env, in precedence order
 * `PUBLIC_URL` → `RENDER_EXTERNAL_URL` → `RAILWAY_PUBLIC_DOMAIN` →
 * `FLY_APP_NAME` → `APP_URL` (DigitalOcean) → `HEROKU_APP_DEFAULT_DOMAIN_NAME`.
 * A set value that is not usable (not http(s), or not a bare host for a
 * host-style source) is skipped with a warning; a URL is reduced to its
 * origin. Pure: warnings go to the optional callback. Returns `null` when no
 * source is usable.
 */
export function resolvePlatformPublicUrl(
  env: PlatformEnv,
  onWarning?: (message: string) => void,
): PlatformPublicUrl | null {
  for (const source of PLATFORM_SOURCES) {
    const raw = env[source.name];
    if (raw === undefined || isUnset(raw)) continue;
    const url = source.toUrl(raw.trim());
    if (url) return { url, source: source.name };
    onWarning?.(
      `Ignoring ${source.name}=${JSON.stringify(raw)}: not ${source.expected}`,
    );
  }
  return null;
}

/** The single boot-log line describing the resolved public URL. */
export function describePublicUrl(resolved: PlatformPublicUrl | null): string {
  return resolved
    ? `public URL: ${resolved.url} (from ${resolved.source})`
    : 'public URL: unresolved';
}

/** Path of the Discord OAuth callback behind the public site. */
export const DISCORD_CALLBACK_PATH = '/api/auth/discord/callback';

/**
 * Default Discord callback when neither the saved setting nor
 * `DISCORD_CALLBACK_URL` is set: `<public url>/api/auth/discord/callback`, or
 * `localFallback` only when no public URL resolves.
 */
export function defaultDiscordCallbackUrl(
  env: PlatformEnv,
  localFallback: string,
): string {
  const resolved = resolvePlatformPublicUrl(env);
  return resolved ? `${resolved.url}${DISCORD_CALLBACK_PATH}` : localFallback;
}
