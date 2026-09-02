// Target resolution for rl_validate_ci (ROK-1466).
//
// Split out of validate-ci.ts to keep that file under the 300-line cap. These
// are the pure seams: hostname <-> slug, base-URL validation, and the env
// prefix that binds the runner's e2e target. No SSH, no I/O.

import { shellQuote } from '../exec.js';

/** The internal hostname an env slug is reachable at from inside the fleet. */
export function envForSlug(slug: string): string {
  return `http://rl-env-${slug}-allinone`;
}

/** Slugs are interpolated into a remote shell command — keep them boring. */
const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Recover the env slug from an internal fleet hostname — the inverse of
 * `envForSlug`.
 *
 * ROK-1466 W1: `against_env_slug` was the ONLY thing that triggered the
 * ROK-1368 admin-password re-seed, so the documented `fleet:true + base_url`
 * flow shipped no `ADMIN_PASSWORD` and global setup 401'd on the literal
 * 'password'. A `base_url` that names an env is just a slug in disguise.
 *
 * @param baseUrl - A sanitised base URL.
 * @returns The slug, or null when the URL does not name a fleet env.
 */
export function slugFromBaseUrl(baseUrl: string): string | null {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return null;
  }
  const match = /^rl-env-(.+)-allinone$/.exec(host);
  if (!match) return null;
  const slug = match[1];
  return SLUG_RE.test(slug) ? slug : null;
}

/**
 * Validate an operator-supplied base URL before it is interpolated into a
 * remote shell command. Only absolute http(s) URLs whose host is a plain
 * hostname/IP (optionally with a port) survive — shell metacharacters, command
 * substitution and non-http schemes all throw rather than reaching the runner.
 *
 * @param raw - The caller's `base_url`.
 * @returns The URL with any trailing slash removed.
 * @throws When the value is not a safe absolute http(s) URL.
 */
export function sanitizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`base_url is not an absolute URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`base_url must be http(s), got ${parsed.protocol}`);
  }
  // Userinfo would otherwise be dropped silently by the `parsed.origin`
  // rebuild below — a credential the caller believed they had passed.
  if (parsed.username || parsed.password) {
    throw new Error('base_url must not carry userinfo (user:password@host)');
  }
  const HOSTNAME = /^[A-Za-z0-9.-]+(:\d+)?$/;
  const IPV6 = /^\[[0-9A-Fa-f:.]+\](:\d+)?$/;
  if (!HOSTNAME.test(parsed.host) && !IPV6.test(parsed.host)) {
    throw new Error(`base_url host is not a plain hostname: ${parsed.host}`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error('base_url must not carry a query string or fragment');
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

/**
 * Build the `KEY=value ` prefix that binds the runner's e2e target.
 *
 * All THREE variables are exported together on purpose. validate-ci probes
 * HEALTH_URL, playwright.config.ts reads BASE_URL, and global setup plus every
 * smoke API helper read API_URL — exporting a subset is the ROK-1466 failure
 * mode where the gate probed the fleet env and then drove localhost.
 *
 * @param opts.baseUrl - Sanitised target; omit for the default (local) gate.
 * @param opts.adminPassword - Seeded env admin password, if one was obtained.
 * @returns A trailing-space-terminated env prefix, or '' when untargeted.
 */
export function resolveInnerEnv(opts: {
  baseUrl?: string;
  adminPassword?: string | null;
}): string {
  if (!opts.baseUrl) return '';
  const base = opts.baseUrl;
  let env =
    `BASE_URL=${shellQuote(base)} ` +
    `API_URL=${shellQuote(`${base}/api`)} ` +
    `HEALTH_URL=${shellQuote(`${base}/api/health`)} `;
  if (opts.adminPassword) {
    env += `ADMIN_PASSWORD=${shellQuote(opts.adminPassword)} `;
  }
  return env;
}
