import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * ROK-1592 (spec §6.2, plan L3): a signed, purpose-bound, user-bound,
 * expiring state token for OAuth round-trips.
 *
 * Token: `base64url(JSON payload) + "." + base64url(HMAC-SHA256)`. The HMAC
 * key is derived from JWT_SECRET per purpose (the `derivePurposeSecret`
 * pattern in `auth/purpose-jwt.helpers.ts`, under its own label), so a state
 * minted for one purpose is a signature failure under another — and no
 * Steam / Discord state can be replayed as a calendar state.
 *
 * Steam and Discord keep their own signers (TECH-DEBT, ROK-1592 L3).
 */
export type SignedStatePurpose = 'calendar-oauth';

/** Default lifetime: 10 minutes. */
export const SIGNED_STATE_TTL_SECONDS = 600;

/** Longer input is refused before any parsing. */
const MAX_TOKEN_LENGTH = 2048;

/** What every verified state carries; purpose fields ride alongside. */
export interface SignedStateClaims {
  /** The user who started the flow. */
  uid: number;
  /** Expiry, epoch seconds. */
  exp: number;
  [field: string]: unknown;
}

function stateKey(purpose: SignedStatePurpose): Buffer {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('JWT_SECRET is not set');
  return createHmac('sha256', base)
    .update(`rl-signed-state:${purpose}`)
    .digest();
}

function sign(body: string, purpose: SignedStatePurpose): Buffer {
  return createHmac('sha256', stateKey(purpose)).update(body).digest();
}

/** Mint a state for `purpose`. `uid` binds it to a user; `exp` is set here. */
export function signState(
  payload: { uid: number } & Record<string, unknown>,
  purpose: SignedStatePurpose,
  opts: { ttlSeconds?: number; nowMs?: number } = {},
): string {
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const ttl = opts.ttlSeconds ?? SIGNED_STATE_TTL_SECONDS;
  const claims = { ...payload, exp: nowSec + ttl };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(body, purpose).toString('base64url')}`;
}

function signatureMatches(
  body: string,
  signature: string,
  purpose: SignedStatePurpose,
): boolean {
  const expected = sign(body, purpose);
  const given = Buffer.from(signature, 'base64url');
  // Node's decoder skips stray characters; insist on the canonical encoding.
  if (given.toString('base64url') !== signature) return false;
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function asClaims(json: string, nowMs: number): SignedStateClaims | null {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  const claims = parsed as Record<string, unknown>;
  const { uid, exp } = claims;
  if (!Number.isSafeInteger(uid) || (uid as number) <= 0) return null;
  if (typeof exp !== 'number' || exp * 1000 <= nowMs) return null;
  return claims as SignedStateClaims;
}

/**
 * Verify a state for `purpose`. Null on EVERY miss — malformed, tampered,
 * wrong purpose, expired, no user — so callers answer them all the same way.
 * Purpose-specific fields are the caller's to validate.
 */
export function verifyState(
  token: string,
  purpose: SignedStatePurpose,
  opts: { nowMs?: number } = {},
): SignedStateClaims | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  if (!body || !signatureMatches(body, signature, purpose)) return null;
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8');
    return asClaims(json, opts.nowMs ?? Date.now());
  } catch {
    return null;
  }
}
