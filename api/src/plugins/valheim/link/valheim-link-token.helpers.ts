/**
 * ROK-1833: the per-server Valheim Link ingest token (calendar-feed precedent,
 * ROK-1599). `rlvl_` + 32 random bytes as 43 base64url chars. Only the sha256
 * hex hash and the last 4 chars are stored; the plaintext is returned once.
 * NEVER log a token, its hash or its hint — log the pelican server id.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { VALHEIM_LINK_TOKEN_PATTERN } from '@raid-ledger/contract';

export { VALHEIM_LINK_TOKEN_PATTERN };

const TOKEN_BYTES = 32;
const TOKEN_PREFIX = 'rlvl_';

/** A fresh 256-bit ingest token. */
export function generateValheimLinkToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

/** True when `value` has the exact shape `generateValheimLinkToken` makes. */
export function isValheimLinkToken(value: string): boolean {
  return VALHEIM_LINK_TOKEN_PATTERN.test(value);
}

/** sha256 of the token as 64 lower-case hex chars (the `token_hash`). */
export function hashValheimLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time compare of two hashes; false on any length mismatch. */
export function tokenHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** True when `token` is well-formed and hashes to `storedHash`. */
export function verifyValheimLinkToken(
  token: string,
  storedHash: string,
): boolean {
  if (!isValheimLinkToken(token)) return false;
  return tokenHashesEqual(hashValheimLinkToken(token), storedHash);
}

/** Last 4 chars, stored as `token_hint` for "…ab12" display. */
export function tokenHintOf(token: string): string {
  return token.slice(-4);
}
