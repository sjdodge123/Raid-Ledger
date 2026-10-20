/**
 * The one place an access JWT is signed. ROK-1823 D10: `iat` and `exp` are
 * plain clock values — revocation is the `tv` (token version) claim compared
 * against `users.token_version`, so no block floor is read at mint.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@raid-ledger/contract';

/** The claims every access JWT carries. */
export interface AccessTokenClaims {
  username: string;
  sub: number;
  role: UserRole;
  /** Set on an impersonation token; `JwtStrategy` checks this id too. */
  impersonatedBy?: number;
  /** ROK-1823: the sub's `users.token_version` at mint. */
  tv: number;
  /** ROK-1823: the impersonator's `users.token_version` (impersonation only). */
  itv?: number;
}

/** Access-token lifetime when a mint gives no `ttlSeconds` (ROK-1353: 1h). */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** How long a token may live, measured from the clock (ROK-1820). */
export interface MintOptions {
  /** Lifetime from the clock; defaults to `ACCESS_TOKEN_TTL_SECONDS`. */
  ttlSeconds?: number;
  /** Absolute deadline (an impersonation marker's `expires_at`). */
  notAfter?: Date;
}

/**
 * ROK-1820: `notAfter` falls at or before the current second, so the token
 * would be born expired. Never signed; callers end the session or fall back
 * (refresh mints the holder's own token).
 */
export class BornExpiredTokenError extends UnauthorizedException {
  constructor() {
    super('Session expired');
  }
}

type MintDeps = { jwt: Pick<JwtService, 'sign'> };

/** `exp` in seconds: `iat + ttl`, capped at `notAfter`. */
export function expiresAtFor(
  options: MintOptions | undefined,
  iat: number,
): number {
  const exp = iat + (options?.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS);
  const notAfter = options?.notAfter;
  return notAfter ? Math.min(exp, Math.floor(notAfter.getTime() / 1000)) : exp;
}

/**
 * Sign an access JWT from ONE clock read: `iat = floor(now)`,
 * `exp = min(iat + ttl, floor(notAfter))`. Throws `BornExpiredTokenError`
 * (nothing signed) when `exp <= iat` — a marker deadline inside the current
 * second (`resolveForRefresh` checks it with ms precision).
 */
export function signAccessToken(
  deps: MintDeps,
  claims: AccessTokenClaims,
  options?: MintOptions,
): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = expiresAtFor(options, iat);
  if (exp <= iat) throw new BornExpiredTokenError();
  // `expiresIn` is counted from the payload `iat`; it also overrides the
  // module default so the two can never disagree.
  return deps.jwt.sign({ ...claims, iat }, { expiresIn: exp - iat });
}
