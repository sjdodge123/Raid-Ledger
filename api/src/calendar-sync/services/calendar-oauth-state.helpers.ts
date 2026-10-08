/**
 * ROK-1592 (plan L3/L4/L5/L6): the calendar OAuth round-trip state.
 *
 * The state is `signState({uid, provider, n, r}, 'calendar-oauth')`:
 * - `n` is a 16-byte random nonce. It is consumed once at the callback
 *   (`consumeTokenOnce`, L5), so a replayed callback URL fails.
 * - `r` is the ROK-1366 browser binding. The start route mints it with
 *   `bindLinkStateToBrowser(res, 'calendar-google')`, and the callback checks
 *   it with `assertLinkStateBoundToBrowser(...)`. Both are passed in as
 *   callbacks so this file stays free of Express and of the auth module.
 *
 * PKCE S256 with a DERIVED verifier (L6): `verifier = base64url(HMAC(key,
 * 'pkce:' + n))`. It is recomputed at the callback from the verified nonce,
 * and is never stored, put in a cookie or put in a URL. The nonce is visible
 * in the state, but the verifier cannot be derived without the server key.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import * as singleUseToken from '../../auth/single-use-token.helpers';
import type * as schema from '../../drizzle/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { signState, verifyState } from '../../common/signed-state.helpers';
import type { CalendarProviderKey } from '../providers/calendar-provider.interface';

type Db = PostgresJsDatabase<typeof schema>;

/** The consumed-token key prefix for a calendar OAuth nonce (L5). */
export const CALENDAR_OAUTH_NONCE_PREFIX = 'calendar-oauth:';

const NONCE_BYTES = 16;

export interface MintCalendarOAuthStateInput {
  uid: number;
  provider: CalendarProviderKey;
  /** Sets the browser-binding cookie and returns its `r`. */
  bindToBrowser: () => string;
  nowMs?: number;
}

export interface CalendarOAuthStart {
  state: string;
  codeChallenge: string;
}

export interface VerifyCalendarOAuthStateInput {
  provider: CalendarProviderKey;
  /** Throws unless this browser holds the cookie for `r`; clears it on a match. */
  assertBoundToBrowser: (r: unknown) => void;
  nowMs?: number;
}

export interface VerifiedCalendarOAuthState {
  uid: number;
  provider: CalendarProviderKey;
  codeVerifier: string;
}

function pkceKey(): Buffer {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('JWT_SECRET is not set');
  return createHmac('sha256', base).update('rl-calendar-oauth-pkce').digest();
}

/** The PKCE verifier for nonce `n`: 43 base64url characters (RFC 7636 §4.1). */
export function deriveCodeVerifier(n: string): string {
  return createHmac('sha256', pkceKey())
    .update(`pkce:${n}`)
    .digest('base64url');
}

/** S256: base64url(sha256(verifier)). */
export function codeChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Start: mint the signed state and the PKCE challenge that goes with it. */
export function mintCalendarOAuthState(
  input: MintCalendarOAuthStateInput,
): CalendarOAuthStart {
  const n = randomBytes(NONCE_BYTES).toString('base64url');
  const r = input.bindToBrowser();
  const state = signState(
    { uid: input.uid, provider: input.provider, n, r },
    'calendar-oauth',
    { nowMs: input.nowMs },
  );
  return { state, codeChallenge: codeChallengeFor(deriveCodeVerifier(n)) };
}

function boundToBrowser(assert: (r: unknown) => void, r: unknown): boolean {
  try {
    assert(r);
    return true;
  } catch {
    return false;
  }
}

/**
 * Callback: null on EVERY miss (tampered, expired, wrong purpose or provider,
 * another browser, replayed), so the caller answers `?error=state` for all.
 * The nonce is consumed last, so only a fully valid state burns it. DB errors
 * propagate.
 */
export async function verifyCalendarOAuthState(
  db: Db,
  token: string,
  input: VerifyCalendarOAuthStateInput,
): Promise<VerifiedCalendarOAuthState | null> {
  const claims = verifyState(token, 'calendar-oauth', { nowMs: input.nowMs });
  if (!claims || claims.provider !== input.provider) return null;
  const { n } = claims;
  if (typeof n !== 'string' || n.length === 0) return null;
  if (!boundToBrowser(input.assertBoundToBrowser, claims.r)) return null;
  const fresh = await singleUseToken.consumeTokenOnce(
    db,
    CALENDAR_OAUTH_NONCE_PREFIX + n,
  );
  if (!fresh) return null;
  return {
    uid: claims.uid,
    provider: input.provider,
    codeVerifier: deriveCodeVerifier(n),
  };
}
