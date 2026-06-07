import * as crypto from 'crypto';

/**
 * ROK-1353: pure helpers for refresh-token generation + hashing.
 * Extracted from refresh-token.service.ts to keep it under the 300-line cap.
 */

export type AuthMethod = 'discord' | 'local' | 'magic';

/** Generate a 256-bit base64url raw token (lives only in the cookie). */
export function generateRawToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 hex of a raw token — the only form stored server-side. */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
