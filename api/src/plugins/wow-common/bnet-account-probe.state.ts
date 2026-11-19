/**
 * ROK-2129 (spec D3–D6): the OAuth round-trip state for the DEMO_MODE
 * Battle.net account-link probe.
 *
 * The state is `signState({uid, n, r, g}, 'bnet-account-probe')` (TTL 600 s):
 * - `n` — 16-byte random nonce, consumed once at the callback
 *   (`consumeTokenOnce(db, 'bnet-probe:' + n)`), so a replayed URL fails.
 * - `r` — 16-byte browser binding. The start route sets the httpOnly cookie
 *   `rl_bnet_probe_r` = sha256(r); the callback recomputes and compares in
 *   constant time, so only the browser that pressed Start can finish.
 * - `g` — the region enum (`us` | `eu`), never a host.
 *
 * PKCE S256 with a DERIVED verifier: `base64url(HMAC(HMAC(JWT_SECRET,
 * 'rl-bnet-probe-pkce'), 'pkce:' + n))`. Recomputed at the callback and never
 * stored, logged, put in a cookie or in a URL.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  BnetProbeRegionSchema,
  type BnetProbeRegion,
} from '@raid-ledger/contract';
import * as singleUseToken from '../../auth/single-use-token.helpers';
import type * as schema from '../../drizzle/schema';
import { signState, verifyState } from '../../common/signed-state.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Prefix for the single-use nonce row in `consumed_intent_tokens`. */
export const BNET_PROBE_NONCE_PREFIX = 'bnet-probe:';

/** The browser-binding cookie set on `/start`, cleared on the callback. */
export const BNET_PROBE_COOKIE = 'rl_bnet_probe_r';

const PURPOSE = 'bnet-account-probe';
const RANDOM_BYTES = 16;

/** What `/start` needs: the state, the S256 challenge and the cookie value. */
export interface BnetProbeStart {
  state: string;
  codeChallenge: string;
  /** sha256(r), base64url — the value of the `rl_bnet_probe_r` cookie. */
  bindingCookieValue: string;
}

/** What a fully verified (and now consumed) state yields to the callback. */
export interface VerifiedBnetProbeState {
  uid: number;
  region: BnetProbeRegion;
  codeVerifier: string;
}

function pkceKey(): Buffer {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('JWT_SECRET is not set');
  return createHmac('sha256', base).update('rl-bnet-probe-pkce').digest();
}

/** The PKCE verifier for nonce `n`: 43 base64url characters (RFC 7636 §4.1). */
export function deriveBnetProbeVerifier(n: string): string {
  return createHmac('sha256', pkceKey())
    .update(`pkce:${n}`)
    .digest('base64url');
}

/** S256: base64url(sha256(verifier)). */
export function bnetProbeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** The cookie value for binding value `r`: base64url(sha256(r)). */
export function bnetProbeBindingHash(r: string): string {
  return createHash('sha256').update(r).digest('base64url');
}

/** Start: mint the signed state, its PKCE challenge and the binding cookie. */
export function startBnetProbeState(input: {
  uid: number;
  region: BnetProbeRegion;
  nowMs?: number;
}): BnetProbeStart {
  const n = randomBytes(RANDOM_BYTES).toString('base64url');
  const r = randomBytes(RANDOM_BYTES).toString('base64url');
  const state = signState(
    { uid: input.uid, n, r, g: input.region },
    PURPOSE,
    input.nowMs === undefined ? {} : { nowMs: input.nowMs },
  );
  return {
    state,
    codeChallenge: bnetProbeCodeChallenge(deriveBnetProbeVerifier(n)),
    bindingCookieValue: bnetProbeBindingHash(r),
  };
}

function cookieMatches(r: string, cookieHash: string | undefined): boolean {
  if (typeof cookieHash !== 'string' || cookieHash.length === 0) return false;
  const expected = Buffer.from(bnetProbeBindingHash(r));
  const given = Buffer.from(cookieHash);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Callback: null on EVERY miss (tampered, other purpose, expired, unknown
 * region, other browser, replayed) so the caller answers `?code=state` for
 * all. The nonce is consumed LAST, so only a fully valid state burns it.
 * DB errors propagate.
 */
export async function verifyBnetProbeState(
  db: Db,
  token: string,
  input: { cookieHash: string | undefined; nowMs?: number },
): Promise<VerifiedBnetProbeState | null> {
  const claims = verifyState(
    token,
    PURPOSE,
    input.nowMs === undefined ? {} : { nowMs: input.nowMs },
  );
  if (!claims) return null;
  const region = BnetProbeRegionSchema.safeParse(claims.g);
  const { n, r } = claims;
  if (!region.success || typeof n !== 'string' || n.length === 0) return null;
  if (typeof r !== 'string' || !cookieMatches(r, input.cookieHash)) return null;
  const fresh = await singleUseToken.consumeTokenOnce(
    db,
    BNET_PROBE_NONCE_PREFIX + n,
  );
  if (!fresh) return null;
  return {
    uid: claims.uid,
    region: region.data,
    codeVerifier: deriveBnetProbeVerifier(n),
  };
}
