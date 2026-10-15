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
  const slug = /^rl-env-(.+)-allinone$/.exec(host)?.[1];
  if (slug === undefined) return null;
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
 * How much of the Playwright suite the runner should execute.
 *
 * `auto` (the script's default) runs only the specs `scripts/smoke/scope-specs.sh`
 * maps the diff to; `all` is the full desktop+mobile suite; `none` skips the
 * tier with a SKIPPED row.
 */
export type E2eScope = 'auto' | 'all' | 'none';

/**
 * ROK-1792 — an explicit Playwright spec list, forwarded as E2E_SPECS. Each path
 * is a repo-relative smoke spec; the character class admits no whitespace,
 * quote, glob or shell metacharacter, and the value is shellQuote'd regardless.
 * It mirrors playwright.config.ts discovery (testDir `./scripts/smoke`,
 * testMatch `/\.smoke\.spec\.ts$/`): a plain `scripts/smoke/*.spec.ts` is a
 * Vitest file Playwright would silently never run.
 * validate-ci.sh re-validates (pattern, no `..`, file exists) and exits 2.
 */
export const E2E_SPEC_PATTERN = /^scripts\/smoke\/[\w./-]+\.smoke\.spec\.ts$/;

/**
 * validate-ci.sh flags under which the Playwright tier never runs, so an
 * explicit list would "pass" without running a single requested spec.
 */
const SPECS_CONFLICTING_FLAGS = [
  '--static',
  '--no-e2e',
  '--only-unit',
  '--only-integration',
  '--contrast-audit',
] as const;
export const MAX_E2E_SPECS = 20;

/**
 * Reject an e2e_specs request validate-ci.sh would refuse (exit 2) — at the MCP
 * boundary, before a dispatch the caller would only learn about by polling.
 *
 * @param specs - The requested spec paths; undefined/empty means "not set".
 * @param scope - e2e_scope; only `auto` (or unset) composes with a list.
 * @param args - The resolved validate-ci.sh flags.
 * @returns An error message, or null when the request is valid.
 */
export function checkE2eSpecs(
  specs: readonly string[] | undefined,
  scope: E2eScope | undefined,
  args: readonly string[] = [],
): string | null {
  if (!specs || specs.length === 0) return null;
  if (specs.length > MAX_E2E_SPECS) {
    return `e2e_specs takes at most ${MAX_E2E_SPECS} paths (got ${specs.length}).`;
  }
  const bad = specs.filter((s) => !E2E_SPEC_PATTERN.test(s) || `/${s}/`.includes('/../'));
  if (bad.length) {
    return `e2e_specs paths must match scripts/smoke/<name>.smoke.spec.ts with no '..': ${bad.join(', ')}`;
  }
  if (scope && scope !== 'auto') {
    return `e2e_specs and e2e_scope:'${scope}' are mutually exclusive — omit e2e_scope (or pass 'auto').`;
  }
  const conflict = args.find((a) => (SPECS_CONFLICTING_FLAGS as readonly string[]).includes(a));
  if (conflict) return `e2e_specs and ${conflict} are mutually exclusive — use --only-e2e.`;
  return null;
}

/**
 * Build the `KEY=value ` prefix that binds the runner's e2e target.
 *
 * All THREE variables are exported together on purpose. validate-ci probes
 * HEALTH_URL, playwright.config.ts reads BASE_URL, and global setup plus every
 * smoke API helper read API_URL — exporting a subset is the ROK-1466 failure
 * mode where the gate probed the fleet env and then drove localhost.
 *
 * ROK-1565 adds E2E_SCOPE, which is independent of the target: a run with no
 * base_url can still pin the Playwright scope, so it is emitted on its own.
 *
 * @param opts.baseUrl - Sanitised target; omit for the default (local) gate.
 * @param opts.adminPassword - Seeded env admin password, if one was obtained.
 * @param opts.e2eScope - Playwright scope for validate-ci.sh; omit for its default.
 * @param opts.e2eSpecs - ROK-1792 explicit spec list (pre-validated by
 *   checkE2eSpecs); emitted as one space-separated, shell-quoted E2E_SPECS.
 * @returns A trailing-space-terminated env prefix, or '' when nothing applies.
 */
export function resolveInnerEnv(opts: {
  baseUrl?: string | undefined;
  adminPassword?: string | null | undefined;
  e2eScope?: E2eScope | undefined;
  e2eSpecs?: readonly string[] | undefined;
}): string {
  let env = '';
  if (opts.baseUrl) {
    const base = opts.baseUrl;
    env +=
      `BASE_URL=${shellQuote(base)} ` +
      `API_URL=${shellQuote(`${base}/api`)} ` +
      `HEALTH_URL=${shellQuote(`${base}/api/health`)} `;
    if (opts.adminPassword) {
      env += `ADMIN_PASSWORD=${shellQuote(opts.adminPassword)} `;
    }
  }
  if (opts.e2eScope) env += `E2E_SCOPE=${shellQuote(opts.e2eScope)} `;
  if (opts.e2eSpecs?.length) env += `E2E_SPECS=${shellQuote(opts.e2eSpecs.join(' '))} `;
  return env;
}
