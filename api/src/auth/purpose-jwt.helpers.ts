import { createHmac } from 'node:crypto';
import type { JwtService } from '@nestjs/jwt';

/**
 * ROK-1366 D1: every short-lived, single-purpose JWT (magic links, link-start
 * nonces) is signed with a secret derived from JWT_SECRET per purpose. No
 * generic `jwtService.verify()` — the JwtStrategy, the WS gateways, the OAuth
 * link hops — can ever accept one, and binding a nonce to a provider is a
 * signature failure rather than a branch someone could get wrong.
 */
export type JwtPurpose =
  'magic-link' | 'link-nonce:discord' | 'link-nonce:steam';

/** HMAC-SHA256(baseSecret, "rl-jwt-purpose:<purpose>"), hex-encoded. */
export function derivePurposeSecret(
  baseSecret: string,
  purpose: JwtPurpose,
): string {
  return createHmac('sha256', baseSecret)
    .update(`rl-jwt-purpose:${purpose}`)
    .digest('hex');
}

/** Read JWT_SECRET at call time (tests and integration set it per suite). */
function purposeSecret(purpose: JwtPurpose): string {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('JWT_SECRET is not set');
  return derivePurposeSecret(base, purpose);
}

/** Sign `payload` for `purpose`. `expiresIn` is seconds or a vercel/ms span. */
export function signPurposeJwt(
  jwt: JwtService,
  purpose: JwtPurpose,
  payload: Record<string, unknown>,
  expiresIn: number | `${number}${'s' | 'm' | 'h'}`,
): string {
  return jwt.sign(payload, { secret: purposeSecret(purpose), expiresIn });
}

/** Verify a `purpose` token. Throws (jsonwebtoken errors) on any failure. */
export function verifyPurposeJwt<T extends object>(
  jwt: JwtService,
  purpose: JwtPurpose,
  token: string,
): T {
  return jwt.verify<T>(token, { secret: purposeSecret(purpose) });
}
