/**
 * ROK-1597 (spec §3.1): Microsoft identity platform v2.0 OAuth for the
 * calendar connect flow — authorize URL (PKCE S256, `common` tenant), code
 * exchange, rotating refresh, and the Graph `/me` identity. Hand-rolled over
 * the `microsoft-http` seam, called through the namespace so specs can spy.
 *
 * Errors are the shared `calendar-provider.errors` classes; their `reason`
 * is the token endpoint's `error` code (`invalid_grant`, `invalid_client`)
 * or `http_<status>` — never a token, code, verifier, the client secret or
 * `error_description` (which echoes AADSTS text and trace ids).
 */
import * as microsoftHttp from './microsoft-http';
import type { MicrosoftHttpResponse } from './microsoft-http';
import { parseRetryAfterMs } from '../google/google-http';
import {
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';
import {
  GRAPH_SCOPE_PREFIX,
  MS_AUTHORIZE_URL,
  MS_CALENDAR_SCOPE,
  MS_ME_URL,
  MS_REQUIRED_SCOPES,
  MS_SCOPES,
  MS_TOKEN_URL,
} from './microsoft-graph.constants';
import {
  assertGraphOk,
  graphNetworkError,
  graphRequest,
} from './microsoft-graph-errors.helpers';

export interface MicrosoftClient {
  clientId: string;
  clientSecret: string;
}

export interface MicrosoftAuthUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

/** A parsed token-endpoint reply. `refreshToken` is null when omitted. */
export interface MicrosoftTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  /** The `scope` echo split on spaces, as returned (not normalised). */
  scopes: string[];
}

/** The Graph `/me` account: `id` is the stable subject. */
export interface MicrosoftIdentity {
  id: string;
  /** `mail`, else `userPrincipalName` (personal accounts have no mail). */
  label: string | null;
}

/** The authorize URL the start route hands the browser. */
export function buildMicrosoftAuthUrl(p: MicrosoftAuthUrlParams): string {
  const query = new URLSearchParams({
    client_id: p.clientId,
    response_type: 'code',
    redirect_uri: p.redirectUri,
    response_mode: 'query',
    scope: MS_SCOPES.join(' '),
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${MS_AUTHORIZE_URL}?${query.toString()}`;
}

/**
 * Strip the Graph resource prefix and lower-case, so a fully-qualified
 * (`https://graph.microsoft.com/Calendars.ReadWrite`) and a bare echo
 * compare equal.
 */
export function normalizeMicrosoftScopes(scopes: readonly string[]): string[] {
  return scopes.map((scope) => {
    const lower = scope.toLowerCase();
    return lower.startsWith(GRAPH_SCOPE_PREFIX)
      ? lower.slice(GRAPH_SCOPE_PREFIX.length)
      : lower;
  });
}

/** Whether a grant holds `Calendars.ReadWrite` (covers read AND write). */
export function hasMicrosoftCalendarScope(scopes: readonly string[]): boolean {
  return normalizeMicrosoftScopes(scopes).includes(
    MS_CALENDAR_SCOPE.toLowerCase(),
  );
}

/** Required scopes the grant lacks (empty = the grant is usable). */
export function missingMicrosoftScopes(scopes: readonly string[]): string[] {
  const granted = normalizeMicrosoftScopes(scopes);
  return MS_REQUIRED_SCOPES.filter(
    (scope) => !granted.includes(scope.toLowerCase()),
  );
}

/** Exchange an authorization code (PKCE + client secret: Web client). */
export async function exchangeMicrosoftCode(
  client: MicrosoftClient,
  input: { code: string; codeVerifier: string; redirectUri: string },
  nowMs = Date.now(),
): Promise<MicrosoftTokenSet> {
  const res = await send({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code_verifier: input.codeVerifier,
  });
  assertTokenOk(res);
  return parseTokenSet(res.json, nowMs);
}

/**
 * Trade a refresh token for a fresh access token. Microsoft ROTATES refresh
 * tokens: the returned `refreshToken` is the one to persist from now on.
 */
export async function refreshMicrosoftToken(
  client: MicrosoftClient,
  refreshToken: string,
  nowMs = Date.now(),
): Promise<MicrosoftTokenSet> {
  const res = await send({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    scope: MS_SCOPES.join(' '),
  });
  assertTokenOk(res);
  return parseTokenSet(res.json, nowMs);
}

/** Read the account behind an access token from Graph `/me`. */
export async function fetchMicrosoftIdentity(
  accessToken: string,
): Promise<MicrosoftIdentity> {
  const res = await graphRequest('GET', MS_ME_URL, accessToken);
  assertGraphOk(res, 'read');
  const me = asRecord(res.json);
  if (typeof me.id !== 'string' || !me.id) {
    throw new ProviderAuthError('identity_missing');
  }
  return {
    id: me.id,
    label: nonEmpty(me.mail) ?? nonEmpty(me.userPrincipalName),
  };
}

async function send(
  form: Record<string, string>,
): Promise<MicrosoftHttpResponse> {
  try {
    return await microsoftHttp.microsoftFormPost(MS_TOKEN_URL, form);
  } catch (err) {
    throw graphNetworkError(err);
  }
}

/**
 * 429 → rate limit; 5xx → transient; any other non-2xx (`invalid_grant`,
 * `invalid_client`, …) → auth, with the code as the reason.
 */
function assertTokenOk(res: MicrosoftHttpResponse): void {
  if (res.status >= 200 && res.status < 300) return;
  const reason = tokenErrorCode(res.json) ?? `http_${res.status}`;
  if (res.status === 429) {
    throw new RateLimitError(parseRetryAfterMs(res.retryAfter), reason);
  }
  if (res.status >= 500) throw new TransientError(reason);
  throw new ProviderAuthError(reason);
}

function parseTokenSet(json: unknown, nowMs: number): MicrosoftTokenSet {
  const { access_token, refresh_token, expires_in, scope } = asRecord(json);
  if (typeof access_token !== 'string' || !access_token) {
    throw new ProviderAuthError('malformed_token_response');
  }
  const ttlSeconds = typeof expires_in === 'number' ? expires_in : 3600;
  return {
    accessToken: access_token,
    refreshToken: nonEmpty(refresh_token),
    expiresAt: new Date(nowMs + ttlSeconds * 1000).toISOString(),
    scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
  };
}

/** The token endpoint's `error` code when it is a plain identifier. */
function tokenErrorCode(json: unknown): string | null {
  const code = asRecord(json).error;
  return typeof code === 'string' && /^[a-z_]{1,48}$/.test(code) ? code : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}
