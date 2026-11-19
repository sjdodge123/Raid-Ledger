/**
 * ROK-2129 L2: the Battle.net user-OAuth calls behind the DEMO_MODE account
 * probe. Pure functions over an injected fetch — no token, code or verifier
 * is ever logged or returned beyond the caller's local scope (spec D7).
 */
import type { BnetProbeRegion } from '@raid-ledger/contract';
import { FOREVER_PROBE_TIMEOUT_MS } from './forever-namespace-probe.helpers';

/** Global Battle.net OAuth host (spec D12 / F2); recorded in the result. */
export const BNET_OAUTH_HOST = 'oauth.battle.net';

/**
 * Scopes requested, space-separated as OAuth2 requires. Spec F6 asked for
 * `wow.profile` only; the operator ruling of 2026-11-07 adds `openid` so the
 * probe can record what Blizzard's userinfo returns (keys only).
 */
export const BNET_PROBE_SCOPE = 'openid wow.profile';

/** The callback route as Nest serves it (no global prefix). */
const NEST_CALLBACK_PATH = '/plugins/blizzard/bnet-account-probe/callback';

/**
 * Callback path as the browser sees it (nginx strips `/api` before Nest).
 * The operator registers `${CLIENT_URL}` + this in the Blizzard console.
 */
export const BNET_PROBE_CALLBACK_PATH = `/api${NEST_CALLBACK_PATH}`;

/** Discord's callback route on the api — its prefix is the api base. */
const DISCORD_CALLBACK_SUFFIX = '/auth/discord/callback';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Admin page the callback lands on (spec "Redirect target"). */
export const BNET_PROBE_RETURN_PATH =
  '/admin/settings/integrations/plugin/blizzard/blizzard-api';

/** Injected fetch (the service passes the global one; specs a fake). */
export type BnetFetch = (url: string, init: RequestInit) => Promise<Response>;

/** What one HTTP call yielded: a status + parsed body, or a transport error. */
export interface BnetCallResult {
  status: number | null;
  error: 'timeout' | 'network' | null;
  body: unknown;
}

function isLoopback(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** `http://localhost:3000` from `http://localhost:3000/auth/discord/callback`. */
function apiBaseFromDiscordCallback(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (!path.endsWith(DISCORD_CALLBACK_SUFFIX)) return null;
    return `${parsed.origin}${path.slice(0, -DISCORD_CALLBACK_SUFFIX.length)}`;
  } catch {
    return null;
  }
}

/**
 * The trusted callback URL (from `getClientUrl` + the deployer's
 * `DISCORD_CALLBACK_URL` env, never Host). Behind nginx it is
 * `${clientUrl}/api/...`. In the split dev env (web on a loopback port with
 * no `/api` proxy) the api's own base comes from the Discord callback env,
 * which already points at Nest (Codex P2) — never on a public client URL.
 */
export function buildBnetProbeRedirectUri(
  clientUrl: string,
  discordCallbackUrl: string | undefined,
): string {
  const apiBase = isLoopback(clientUrl)
    ? apiBaseFromDiscordCallback(discordCallbackUrl)
    : null;
  return apiBase !== null
    ? `${apiBase}${NEST_CALLBACK_PATH}`
    : `${clientUrl.replace(/\/+$/, '')}${BNET_PROBE_CALLBACK_PATH}`;
}

/** Where the callback 302s: `?bnetProbe=ok` or `?bnetProbe=error&code=…`. */
export function bnetProbeReturnLocation(
  clientUrl: string,
  code: string | null,
): string {
  const base = `${clientUrl.replace(/\/+$/, '')}${BNET_PROBE_RETURN_PATH}`;
  return code === null
    ? `${base}?bnetProbe=ok`
    : `${base}?bnetProbe=error&code=${encodeURIComponent(code)}`;
}

/** The consent-screen URL (authorization code + PKCE S256). */
export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: BNET_PROBE_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://${BNET_OAUTH_HOST}/authorize?${params.toString()}`;
}

/** The four namespaces the account summary is asked for (spec §1.2). */
export function bnetProbeNamespaces(
  foreverPrefix: string,
  region: BnetProbeRegion,
): string[] {
  return [
    `profile-${foreverPrefix}-${region}`,
    `profile-classic1x-${region}`,
    `profile-classic-${region}`,
    `profile-${region}`,
  ];
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _raw: text };
  }
}

/** One call with the probe timeout; transport failures become `error`. */
export async function callBnet(
  fetchFn: BnetFetch,
  url: string,
  init: RequestInit,
): Promise<BnetCallResult> {
  try {
    const signal = AbortSignal.timeout(FOREVER_PROBE_TIMEOUT_MS);
    const res = await fetchFn(url, { ...init, signal });
    return { status: res.status, error: null, body: await readBody(res) };
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError';
    return { status: null, error: timeout ? 'timeout' : 'network', body: null };
  }
}

/** Token request body; `codeVerifier: null` = the no-PKCE retry (F3). */
export function exchangeCode(
  fetchFn: BnetFetch,
  input: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string | null;
    redirectUri: string;
  },
): Promise<BnetCallResult> {
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  if (input.codeVerifier !== null) {
    body.set('code_verifier', input.codeVerifier);
  }
  return callBnet(fetchFn, `https://${BNET_OAUTH_HOST}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic.toString('base64')}`,
    },
    body,
  });
}

/** Did a failed token call complain about PKCE (F3 retry trigger)? */
export function isPkceRejection(result: BnetCallResult): boolean {
  if (result.status === null || result.status < 400) return false;
  const text = JSON.stringify(result.body ?? '').toLowerCase();
  return /code_verifier|code_challenge|pkce/.test(text);
}

/** `GET /profile/user/wow` for one namespace with the user's token. */
export function fetchUserSummary(
  fetchFn: BnetFetch,
  input: { region: BnetProbeRegion; namespace: string; accessToken: string },
): Promise<BnetCallResult> {
  const q = new URLSearchParams({
    namespace: input.namespace,
    locale: 'en_US',
  });
  const url = `https://${input.region}.api.blizzard.com/profile/user/wow?${q.toString()}`;
  return callBnet(fetchFn, url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
}
