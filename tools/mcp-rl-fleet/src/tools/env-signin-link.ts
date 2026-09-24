// rl_env_signin_link — mint a 15-minute magic sign-in link on a fleet env so an
// agent browser-verification lane can load the app as a real user WITHOUT ever
// typing a password (operator ruling 2026-09-24).
//
// Server-side flow (none of the intermediate secrets reach the caller):
//   1. slug -> slot via `rl status` (the rl_env_list source) -> the slot-stable
//      https://slot-N.<RL_PUBLIC_DOMAIN> URL. Never the per-slug public_url
//      (Discord OAuth and the magic-link redirect are registered on the slot).
//   2. admin@local password via the ROK-1368 re-seed (env-admin-seed.ts), in
//      its requireFixed form: ONLY the stable RL_ADMIN_PASSWORD is re-asserted.
//      When the VM has none, the tool fails with admin_seed_failed rather than
//      rotating admin@local to a random password (which would break a
//      concurrent rl_validate_ci re-login and any tester's session).
//   3. POST <base>/api/auth/local as admin@local -> bearer token.
//   4. POST <base>/api/admin/test/sign-in-link (JWT admin + DEMO_MODE).
//
// Redaction contract: the result carries ONLY {ok, url, user_id,
// expires_in_seconds, base_url} or {ok:false, error, status?, message}. The
// admin password and the admin access token are scrubbed from every message.

import { getSshTarget } from '../exec.js';
import { seedFixedEnvAdminPassword, type FixedSeedResult } from './env-admin-seed.js';
import * as envList from './env-list.js';

export const TOOL_NAME = 'rl_env_signin_link';
export const TOOL_DESCRIPTION =
  'For agent browser-verification lanes: mint a 15-minute magic sign-in link for a fleet env so you can load the app as a real user WITHOUT typing a password (never type one into a form). Signs in as the env admin (admin@local) by default; pass user_id OR username (exact, case-sensitive match on users.username; lowest id wins on duplicates) to sign in as someone else, and path (same-origin, default "/") to land on a specific page. Resolves the slot-stable https://slot-N URL itself and returns {ok, url, user_id, expires_in_seconds, base_url}. Open `url` in a FRESH browser context (new incognito/profile/tab group) so no other session cookie interferes. The token in `url` is a 15-minute, env-only credential: NEVER paste `url` into reports, PR bodies, test plans or Linear — hand out base_url + path instead. The env must run an image with POST /admin/test/sign-in-link and DEMO_MODE=true; a 404 on an existing user means the image predates it. Side effect: re-asserts admin@local to the stable RL_ADMIN_PASSWORD (unchanged); if the VM has no RL_ADMIN_PASSWORD it fails with admin_seed_failed instead of rotating it. Fails closed if another env shares the slot. The admin password and admin token are never returned or logged.';

const SLUG_RE = /^[a-z0-9-]+$/;
const ADMIN_EMAIL = 'admin@local';
const HTTP_TIMEOUT_MS = 20_000;
const MAX_MESSAGE = 200;

export interface SigninLinkParams {
  slug: string;
  user_id?: number;
  username?: string;
  path?: string;
  /** Accepted for call-shape parity with slot tools; this tool touches no slot. */
  worktree_path?: string;
}

export interface SigninLinkResult {
  ok: boolean;
  url?: string;
  user_id?: number;
  expires_in_seconds?: number;
  base_url?: string;
  error?: string;
  status?: number;
  message?: string;
}

export interface SigninLinkDeps {
  listEnvs: () => Promise<{ ok: boolean; envs: Array<{ slug: string | null; slot: string | null }>; error?: string }>;
  seedPassword: (slug: string) => Promise<FixedSeedResult>;
  fetch: typeof fetch;
  publicDomain: string;
}

/** Production wiring — tests inject their own. */
export function defaultDeps(): SigninLinkDeps {
  return {
    listEnvs: envList.execute,
    seedPassword: async (slug) => {
      const { user, host } = await getSshTarget();
      return seedFixedEnvAdminPassword(user, host, slug);
    },
    fetch: globalThis.fetch,
    publicDomain: process.env.RL_PUBLIC_DOMAIN ?? 'gamernight.net',
  };
}

/** Replace every secret occurrence with *** and cap the length. */
export function scrub(text: string, secrets: Array<string | null | undefined>): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('***');
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}…` : out;
}

function fail(error: string, message: string, status?: number): SigninLinkResult {
  return { ok: false, error, message, ...(status !== undefined ? { status } : {}) };
}

function validate(p: SigninLinkParams): string | null {
  if (!p || typeof p.slug !== 'string' || !SLUG_RE.test(p.slug)) return 'slug must match [a-z0-9-]+';
  if (p.user_id !== undefined && p.username !== undefined) return 'pass user_id OR username, not both';
  if (p.user_id !== undefined && (!Number.isInteger(p.user_id) || p.user_id < 1)) {
    return 'user_id must be a positive integer';
  }
  if (p.path !== undefined && (!p.path.startsWith('/') || p.path.startsWith('//'))) {
    return 'path must be a same-origin absolute path starting with a single "/"';
  }
  return null;
}

type BaseResolution = { baseUrl: string } | SigninLinkResult;

async function resolveBaseUrl(slug: string, deps: SigninLinkDeps): Promise<BaseResolution> {
  const listed = await deps.listEnvs();
  if (!listed.ok) return fail('env_list_failed', scrub(listed.error ?? 'rl status failed', []));
  const env = listed.envs.find((e) => e.slug === slug);
  if (!env) return fail('env_not_found', `no running env with slug "${slug}" (see rl_env_list)`);
  if (!env.slot || !/^\d+$/.test(env.slot)) return fail('slot_unknown', `env "${slug}" has no slot label`);
  const baseUrl = `https://slot-${env.slot}.${deps.publicDomain}`;
  // Fail closed: the slot URL routes to whichever env owns the slot, so with a
  // sibling present the link could land on (and sign into) the wrong env.
  // One env is several containers (allinone + pg), each listed with the same
  // slug — so count distinct slugs, not rows.
  const onSlot = [...new Set(listed.envs.filter((e) => e.slot === env.slot).map((e) => e.slug ?? '(unnamed)'))];
  if (onSlot.length !== 1) {
    return fail('slot_shared', `slot ${env.slot} hosts ${onSlot.length} envs (${onSlot.join(', ')}); destroy the others so the slot URL routes to "${slug}"`);
  }
  return { baseUrl };
}

async function postJson(
  deps: SigninLinkDeps,
  url: string,
  body: unknown,
  bearer?: string,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

type AdminSession = { token: string; adminId: number } | SigninLinkResult;

async function loginAdmin(deps: SigninLinkDeps, baseUrl: string, password: string): Promise<AdminSession> {
  const { status, json } = await postJson(deps, `${baseUrl}/api/auth/local`, {
    email: ADMIN_EMAIL,
    password,
  });
  const token = typeof json?.access_token === 'string' ? json.access_token : null;
  const user = json?.user as { id?: unknown } | undefined;
  if (status < 200 || status >= 300 || !token || typeof user?.id !== 'number') {
    // Deliberately no body passthrough: a login response is the one place a
    // token could appear, and its message adds nothing the status does not.
    return fail('admin_login_failed', `${ADMIN_EMAIL} login returned HTTP ${status}`, status);
  }
  return { token, adminId: user.id };
}

function linkBody(p: SigninLinkParams, adminId: number): Record<string, unknown> {
  const target =
    p.user_id !== undefined
      ? { userId: p.user_id }
      : p.username !== undefined
        ? { username: p.username }
        : { userId: adminId };
  return p.path !== undefined ? { ...target, path: p.path } : target;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function endpointMessage(json: Record<string, unknown> | null, status: number): string {
  const m = json?.message;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join('; ');
  return `sign-in-link endpoint returned HTTP ${status}`;
}

async function mintLink(
  deps: SigninLinkDeps,
  baseUrl: string,
  p: SigninLinkParams,
  session: { token: string; adminId: number },
  password: string,
): Promise<SigninLinkResult> {
  const { status, json } = await postJson(
    deps,
    `${baseUrl}/api/admin/test/sign-in-link`,
    linkBody(p, session.adminId),
    session.token,
  );
  const secrets = [password, session.token];
  if (status < 200 || status >= 300) {
    return fail('signin_link_failed', scrub(endpointMessage(json, status), secrets), status);
  }
  if (typeof json?.url !== 'string') {
    return fail('signin_link_malformed', 'endpoint returned 2xx without a url', status);
  }
  if (originOf(json.url) !== new URL(baseUrl).origin) {
    // The env's CLIENT_URL disagrees with the slot URL; never hand out a link
    // to another origin. The url itself is withheld (it carries a token).
    return fail('signin_link_wrong_origin', `endpoint returned a link off ${baseUrl}`, status);
  }
  return {
    ok: true,
    url: json.url,
    user_id: typeof json.userId === 'number' ? json.userId : undefined,
    expires_in_seconds: typeof json.expiresInSeconds === 'number' ? json.expiresInSeconds : undefined,
    base_url: baseUrl,
  };
}

function seedFailureMessage(reason: 'no_fixed_password' | 'seed_failed', slug: string): string {
  return reason === 'no_fixed_password'
    ? `RL_ADMIN_PASSWORD is not set on the VM; set RL_ADMIN_PASSWORD in /srv/rl-infra/.env (refusing to rotate ${ADMIN_EMAIL} to a random password)`
    : `could not re-assert ${ADMIN_EMAIL} on env "${slug}"`;
}

/**
 * Execute rl_env_signin_link. Never throws; every failure is a redacted
 * `{ok:false, error, status?, message}` envelope.
 */
export async function execute(
  params: SigninLinkParams,
  deps: SigninLinkDeps = defaultDeps(),
): Promise<SigninLinkResult> {
  const invalid = validate(params);
  if (invalid) return fail('invalid_params', invalid);
  let password: string | null = null;
  let token: string | null = null;
  try {
    const base = await resolveBaseUrl(params.slug, deps);
    if (!('baseUrl' in base)) return base;
    const seeded = await deps.seedPassword(params.slug);
    if (!seeded.ok) return fail('admin_seed_failed', seedFailureMessage(seeded.reason, params.slug));
    password = seeded.password;
    const session = await loginAdmin(deps, base.baseUrl, password);
    if (!('token' in session)) return session;
    token = session.token;
    return await mintLink(deps, base.baseUrl, params, session, password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail('request_failed', scrub(msg, [password, token]));
  }
}
