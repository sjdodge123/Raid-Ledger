/**
 * ROK-1592: Google OAuth 2.0 calls for the calendar connect flow (spec
 * ROK-669 §4.2; plan §2 "Google request shapes"). Hand-rolled over
 * `googleFormPost` (Q6), called through the namespace so specs can spy.
 *
 * Errors are the shared `calendar-provider.errors` classes; their `reason`
 * is Google's `error` code (`invalid_grant`) or `http_<status>` — never a
 * token, code, verifier, the client secret or `error_description`.
 */
import * as googleHttp from './google-http';
import type { GoogleHttpResponse } from './google-http';
import {
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_CALENDAR_APP_CREATED_SCOPE =
  'https://www.googleapis.com/auth/calendar.app.created';
/** The RULED connect scope set (OPERATOR-1, 2026-10-08) — nothing else. */
export const GOOGLE_CONNECT_SCOPES = `openid email ${GOOGLE_CALENDAR_APP_CREATED_SCOPE}`;
/** Scopes a grant must hold to be stored (Q-F: partial grant → revoke). */
export const GOOGLE_REQUIRED_SCOPES = [GOOGLE_CALENDAR_APP_CREATED_SCOPE];
export const GOOGLE_REVOKE_TIMEOUT_MS = 5_000;
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const DEFAULT_RETRY_AFTER_MS = 60_000;

/**
 * The grant lacks a required scope (the user unticked it on Google's
 * granular consent, U4). The callback maps it to `?error=scopes`; the
 * adapter has already attempted a revoke and nothing is stored (Q-F).
 */
export class MissingScopesError extends Error {
  readonly code = 'scopes' as const;
  constructor(readonly missing: string[]) {
    super(`Calendar grant is missing required scopes: ${missing.join(' ')}`);
    this.name = 'MissingScopesError';
  }
}

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export interface GoogleAuthUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

/** A parsed token-endpoint reply. `refreshToken` is null when omitted. */
export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
  idToken: string | null;
}

export interface GoogleIdentity {
  sub: string;
  email: string | null;
}

/** The authorize URL the start route hands the browser. */
export function buildGoogleAuthUrl(p: GoogleAuthUrlParams): string {
  const query = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CONNECT_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${GOOGLE_AUTH_URL}?${query.toString()}`;
}

/** Exchange an authorization code (PKCE) for tokens. */
export async function exchangeGoogleCode(
  client: GoogleClient,
  input: { code: string; codeVerifier: string; redirectUri: string },
  nowMs = Date.now(),
): Promise<GoogleTokenSet> {
  const res = await send(GOOGLE_TOKEN_URL, {
    grant_type: 'authorization_code',
    code: input.code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  assertOk(res);
  return parseTokenSet(res.json, nowMs);
}

/** Trade a refresh token for a fresh access token. */
export async function refreshGoogleToken(
  client: GoogleClient,
  refreshToken: string,
  nowMs = Date.now(),
): Promise<GoogleTokenSet> {
  const res = await send(GOOGLE_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  assertOk(res);
  return parseTokenSet(res.json, nowMs);
}

/** Revoke a token. Google's 400 `invalid_token` (already dead) is success. */
export async function revokeGoogleToken(token: string): Promise<void> {
  const res = await send(
    GOOGLE_REVOKE_URL,
    { token },
    GOOGLE_REVOKE_TIMEOUT_MS,
  );
  if (res.status === 400 && googleErrorCode(res.json) === 'invalid_token') {
    return;
  }
  assertOk(res);
}

/**
 * Read the id_token claims. No JWKS signature check: the token came straight
 * from the token endpoint over TLS (OIDC Core §3.1.3.7, U3); the claims are
 * still validated.
 */
export function parseGoogleIdToken(
  idToken: string,
  clientId: string,
  nowMs = Date.now(),
): GoogleIdentity {
  const claims = decodeJwtPayload(idToken);
  const { iss, aud, exp, sub, email } = claims;
  if (typeof iss !== 'string' || !GOOGLE_ISSUERS.includes(iss)) {
    throw idTokenError('iss');
  }
  if (aud !== clientId) throw idTokenError('aud');
  if (typeof exp !== 'number' || exp * 1000 <= nowMs) {
    throw idTokenError('exp');
  }
  if (typeof sub !== 'string' || !sub) throw idTokenError('sub');
  return { sub, email: typeof email === 'string' && email ? email : null };
}

/** Required scopes the grant lacks (empty = the grant is usable). */
export function missingGoogleScopes(granted: string[]): string[] {
  return GOOGLE_REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
}

async function send(
  url: string,
  form: Record<string, string>,
  timeoutMs?: number,
): Promise<GoogleHttpResponse> {
  try {
    return await googleHttp.googleFormPost(url, form, { timeoutMs });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new TransientError(timedOut ? 'timeout' : 'network');
  }
}

/** 429 → rate limit; 5xx → transient; any other non-2xx → auth. */
function assertOk(res: GoogleHttpResponse): void {
  if (res.status >= 200 && res.status < 300) return;
  const reason = googleErrorCode(res.json) ?? `http_${res.status}`;
  if (res.status === 429) {
    throw new RateLimitError(parseRetryAfterMs(res.retryAfter), reason);
  }
  if (res.status >= 500) throw new TransientError(reason);
  throw new ProviderAuthError(reason);
}

function parseTokenSet(json: unknown, nowMs: number): GoogleTokenSet {
  const body = asRecord(json);
  const { access_token, refresh_token, expires_in, scope, id_token } = body;
  if (typeof access_token !== 'string' || !access_token) {
    throw new ProviderAuthError('malformed_token_response');
  }
  const ttlSeconds = typeof expires_in === 'number' ? expires_in : 3600;
  return {
    accessToken: access_token,
    refreshToken:
      typeof refresh_token === 'string' && refresh_token ? refresh_token : null,
    expiresAt: new Date(nowMs + ttlSeconds * 1000).toISOString(),
    scopes: typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [],
    idToken: typeof id_token === 'string' && id_token ? id_token : null,
  };
}

/** Google's `error` code when it is a plain identifier, else null. */
function googleErrorCode(json: unknown): string | null {
  const code = asRecord(json).error;
  return typeof code === 'string' && /^[a-z_]{1,48}$/.test(code) ? code : null;
}

function parseRetryAfterMs(raw: string | null, nowMs = Date.now()): number {
  if (!raw) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, at - nowMs);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw idTokenError('format');
  try {
    const text = Buffer.from(parts[1], 'base64url').toString('utf8');
    return asRecord(JSON.parse(text));
  } catch {
    throw idTokenError('payload');
  }
}

function idTokenError(claim: string): ProviderAuthError {
  return new ProviderAuthError(`id_token_${claim}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
