/**
 * ROK-1810: the one place an access JWT's `iat` is decided. `isBlocked`
 * rejects `iat <= blockStamp` (whole seconds), so a token minted in the same
 * second as a `blockUser` would be born revoked. Every access-token mint goes
 * through `signAccessToken`, which signs with `iat = max(now, stamp + 1)`.
 */
import type { JwtService, JwtSignOptions } from '@nestjs/jwt';
import type { UserRole } from '@raid-ledger/contract';
import type { TokenBlocklistService } from './token-blocklist.service';

/** The claims every access JWT carries. */
export interface AccessTokenClaims {
  username: string;
  sub: number;
  role: UserRole;
  /** Set on an impersonation token; `JwtStrategy` checks this id's block too. */
  impersonatedBy?: number;
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
 * Sign an access JWT whose `iat` a live block can never reject. `nowMs` lets
 * a caller pin the clock to the moment it read the block floor (the refresh
 * path's revoke-race guard), so a block written after that read still
 * covers the token.
 */
export async function signAccessToken(
  deps: MintDeps,
  claims: AccessTokenClaims,
  options?: JwtSignOptions,
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = issuedAtFor(await blockFloor(deps.blocklist, claims), nowMs);
  return deps.jwt.sign({ ...claims, iat }, options);
}
