/**
 * ROK-1810: the one place an access JWT's `iat` is decided. `isBlocked`
 * rejects `iat <= blockStamp` (whole seconds), so a token minted in the same
 * second as a `blockUser` would be born revoked. Every access-token mint goes
 * through `signAccessToken`, which signs with `iat = max(now, stamp + 1)`.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@raid-ledger/contract';
import type { TokenBlocklistService } from './token-blocklist.service';

/** The claims every access JWT carries. */
export interface AccessTokenClaims {
  username: string;
  sub: number;
  role: UserRole;
  /** Set on an impersonation token; `JwtStrategy` checks this id's block too. */
  impersonatedBy?: number;
  /** ROK-1823: the sub's `users.token_version` at mint (required from L2a). */
  tv?: number;
}

/** Access-token lifetime when a mint gives no `ttlSeconds` (ROK-1353: 1h). */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * ROK-1820: how long a token may live, both measured from the real clock —
 * never from a floor-raised `iat`.
 */
export interface MintOptions {
  /** Lifetime from the clock; defaults to `ACCESS_TOKEN_TTL_SECONDS`. */
  ttlSeconds?: number;
  /** Absolute deadline (an impersonation marker's `expires_at`). */
  notAfter?: Date;
}

/**
 * ROK-1820: the block floor pushed `iat` to or past the token's deadline, so
 * the token would be born expired. Never signed; callers end the session or
 * fall back (refresh mints the holder's own token).
 */
export class BornExpiredTokenError extends UnauthorizedException {
  constructor() {
    super('Session expired');
  }
}

type MintDeps = {
  jwt: Pick<JwtService, 'sign'>;
  blocklist: Pick<TokenBlocklistService, 'minIatFor'>;
};

/** `floor(now)` in seconds, raised to `minIat` when a block floor is live. */
export function issuedAtFor(
  minIat: number | undefined,
  nowMs: number = Date.now(),
): number {
  const now = Math.floor(nowMs / 1000);
  return minIat === undefined ? now : Math.max(now, minIat);
}

/** Highest block floor across the ids `JwtStrategy` will check. */
async function blockFloor(
  blocklist: MintDeps['blocklist'],
  claims: AccessTokenClaims,
): Promise<number | undefined> {
  const ids =
    claims.impersonatedBy === undefined
      ? [claims.sub]
      : [claims.sub, claims.impersonatedBy];
  const floors = await Promise.all(ids.map((id) => blocklist.minIatFor(id)));
  let max: number | undefined;
  for (const floor of floors) {
    if (floor !== undefined) max = Math.max(max ?? floor, floor);
  }
  return max;
}

/**
 * `exp` in seconds: `clock + ttl`, capped at `notAfter`. Anchored to the
 * clock so a floor-raised `iat` never lengthens the token (ROK-1820).
 */
export function expiresAtFor(
  options: MintOptions | undefined,
  nowMs: number,
): number {
  const ttl = options?.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
  const exp = Math.floor(nowMs / 1000) + ttl;
  const notAfter = options?.notAfter;
  return notAfter ? Math.min(exp, Math.floor(notAfter.getTime() / 1000)) : exp;
}

/**
 * Sign an access JWT whose `iat` a live block can never reject and whose
 * `exp` is anchored to the clock (and to `notAfter`). `nowMs` lets a caller
 * pin the clock to the moment it read the block floor (the refresh path's
 * revoke-race guard), so a block written after that read still covers the
 * token. Throws `BornExpiredTokenError` when the floor leaves no lifetime.
 */
export async function signAccessToken(
  deps: MintDeps,
  claims: AccessTokenClaims,
  options?: MintOptions,
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = issuedAtFor(await blockFloor(deps.blocklist, claims), nowMs);
  const exp = expiresAtFor(options, nowMs);
  if (exp <= iat) throw new BornExpiredTokenError();
  // `expiresIn` is counted from the payload `iat`; it also overrides the
  // module default so the two can never disagree.
  return deps.jwt.sign({ ...claims, iat }, { expiresIn: exp - iat });
}
