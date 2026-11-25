import { createHash, randomBytes, randomInt } from 'crypto';

/**
 * ROK-2370: the sign-in code alphabet — Crockford-style, without the
 * look-alikes 0/O, 1/I/L and U, so a code read off a screen types cleanly.
 */
export const SIGNIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** A code (and its device index) lives 10 minutes. */
export const SIGNIN_CODE_TTL_SECONDS = 600;

/** How often the page should poll; the poll tier allows 40/min per IP. */
export const SIGNIN_CODE_POLL_INTERVAL_MS = 3000;

const GROUP = 4;
const ALLOWED = new Set(SIGNIN_CODE_ALPHABET);

/** A fresh `XXXX-XXXX` code drawn with `crypto.randomInt` (≈39.6 bits). */
export function generateSigninCode(): string {
  let raw = '';
  for (let i = 0; i < GROUP * 2; i += 1) {
    raw += SIGNIN_CODE_ALPHABET[randomInt(SIGNIN_CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, GROUP)}-${raw.slice(GROUP)}`;
}

/**
 * Read a typed code: case-insensitive, spaces and dashes ignored. Returns the
 * canonical `XXXX-XXXX`, or null when it is not 8 alphabet characters.
 */
export function normaliseSigninCode(typed: string): string | null {
  const raw = typed.toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== GROUP * 2) return null;
  for (const ch of raw) if (!ALLOWED.has(ch)) return null;
  return `${raw.slice(0, GROUP)}-${raw.slice(GROUP)}`;
}

/** The page's polling credential: 32 random bytes, base64url (43 chars). */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this digest of the device secret is ever stored. */
export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** The pending record of a code. */
export function codeKey(code: string): string {
  return `signin-code:code:${code}`;
}

/** The single-use approval of a code (written once with SET NX). */
export function approvalKey(code: string): string {
  return `signin-code:ok:${code}`;
}

/** Device index: secret hash → code. */
export function deviceKey(secretHash: string): string {
  return `signin-code:dev:${secretHash}`;
}
