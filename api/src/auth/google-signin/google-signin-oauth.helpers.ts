/**
 * ROK-2371: Sign in with Google — authorize URL, PKCE, OIDC nonce and the
 * signed round-trip state. Reused by the Profile link flow (L2c).
 *
 * The state is a purpose JWT (`google-signin-state`) of
 * `{ action, n, r, uid? }`:
 * - `n` is a 16-byte random seed. The PKCE verifier and the OIDC nonce are
 *   both DERIVED from it with a server-keyed HMAC (calendar pattern,
 *   `calendar-oauth-state.helpers.ts`), so neither is stored, cookied or put
 *   in a URL; the callback recomputes them from the verified state.
 * - `r` is the browser binding minted by `bindLinkStateToBrowser`.
 * - `uid` is only set for `action: 'link'` (the signed-in user).
 *
 * Nothing here logs: the state, nonce and verifier are secrets in transit.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { JwtService } from '@nestjs/jwt';
import { GOOGLE_AUTH_URL } from '../../calendar-sync/providers/google/google-oauth.helpers';
import { signPurposeJwt, verifyPurposeJwt } from '../purpose-jwt.helpers';

export type GoogleSigninAction = 'signin' | 'link' | 'pending-link';

const ACTIONS: readonly GoogleSigninAction[] = [
  'signin',
  'link',
  'pending-link',
];

/** Basic scopes only (ruling 5) — never a calendar scope. */
export const GOOGLE_SIGNIN_SCOPES = 'openid email profile';
/** Consumed-once key prefix for a state seed. */
export const GOOGLE_SIGNIN_SEED_PREFIX = 'google-signin-state:';
export const GOOGLE_SIGNIN_STATE_TTL_SECONDS = 600;

const SEED_BYTES = 16;

export interface GoogleSigninState {
  action: GoogleSigninAction;
  n: string;
  r: string;
  uid?: number;
}

function derivationKey(): Buffer {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('JWT_SECRET is not set');
  return createHmac('sha256', base).update('rl-google-signin').digest();
}

function derive(label: string, n: string): string {
  return createHmac('sha256', derivationKey())
    .update(`${label}:${n}`)
    .digest('base64url');
}

/** PKCE verifier for seed `n`: 43 base64url chars (RFC 7636 §4.1). */
export function deriveSigninVerifier(n: string): string {
  return derive('pkce', n);
}

/** OIDC nonce for seed `n`; the id_token must echo it. */
export function deriveSigninNonce(n: string): string {
  return derive('nonce', n);
}

/** S256: base64url(sha256(verifier)). */
export function signinCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface GoogleSigninUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  /** The state's seed; the nonce + PKCE challenge derive from it. */
  n: string;
}

/**
 * The sign-in authorize URL. Unlike `buildGoogleAuthUrl` (calendar): online
 * access, account chooser, no incremental grants, plus an OIDC nonce.
 */
export function buildGoogleSigninUrl(p: GoogleSigninUrlParams): string {
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SIGNIN_SCOPES,
    access_type: 'online',
    prompt: 'select_account',
    state: p.state,
    nonce: deriveSigninNonce(p.n),
    code_challenge: signinCodeChallenge(deriveSigninVerifier(p.n)),
    code_challenge_method: 'S256',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface SignGoogleSigninStateInput {
  action: GoogleSigninAction;
  r: string;
  uid?: number;
}

/** Mint the signed state and return it with its seed. */
export function signGoogleSigninState(
  jwt: JwtService,
  input: SignGoogleSigninStateInput,
): { state: string; n: string } {
  const n = randomBytes(SEED_BYTES).toString('base64url');
  const payload: Record<string, unknown> = {
    action: input.action,
    n,
    r: input.r,
    ...(input.uid === undefined ? {} : { uid: input.uid }),
  };
  const state = signPurposeJwt(
    jwt,
    'google-signin-state',
    payload,
    GOOGLE_SIGNIN_STATE_TTL_SECONDS,
  );
  return { state, n };
}

function isAction(value: unknown): value is GoogleSigninAction {
  return ACTIONS.some((a) => a === value);
}

function claimsOf(jwt: JwtService, token: string): Record<string, unknown> {
  try {
    return verifyPurposeJwt<Record<string, unknown>>(
      jwt,
      'google-signin-state',
      token,
    );
  } catch {
    return {};
  }
}

/** Verify a state; null on a bad signature, expiry or malformed claims. */
export function verifyGoogleSigninState(
  jwt: JwtService,
  token: unknown,
): GoogleSigninState | null {
  if (typeof token !== 'string' || !token || token.length > 2048) return null;
  const { action, n, r, uid } = claimsOf(jwt, token);
  if (!isAction(action)) return null;
  if (typeof n !== 'string' || !n || typeof r !== 'string' || !r) return null;
  if (action === 'link') {
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 0) {
      return null;
    }
    return { action, n, r, uid };
  }
  return { action, n, r };
}
