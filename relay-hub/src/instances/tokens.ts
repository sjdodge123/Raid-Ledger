import { createHash, randomBytes } from 'crypto';

/** `rlh_` + 32 random bytes as base64url (43 chars), L6 (ROK-1671). */
export const TOKEN_PATTERN = /^rlh_[A-Za-z0-9_-]{43}$/;

/** Mints a fresh instance token. The caller shows it once and stores only its hash. */
export function mintToken(): string {
  return `rlh_${randomBytes(32).toString('base64url')}`;
}

/** SHA-256 hex of the full `rlh_…` token: the only form the hub stores. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
