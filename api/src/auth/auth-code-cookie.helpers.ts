import * as crypto from 'crypto';
import type { Request, Response } from 'express';
import { linkCookieAttrs, readCookie } from './link-nonce-cookie.helpers';

/**
 * ROK-1808 (review M1): the one-time `auth_code` the OAuth callback hands to
 * `/auth/success?code=` is bound to the browser that finished the login.
 *
 * Without it an attacker could finish their own Discord login, keep the
 * `?code=` from the 302 unopened, and send a victim the link within its 30 s
 * life — the victim's SPA would exchange it and sign in as the attacker.
 *
 * So the callback sets an httpOnly cookie of sha256(code) on the same
 * response, and `POST /auth/exchange-code` accepts the code only from a
 * browser holding that cookie. Path '/' for the dev `/auth` vs prod
 * `/api/auth` split (same as the link-state cookies).
 */
export const AUTH_CODE_COOKIE = 'rl_auth_code';

/** Matches the Redis `auth_code:` TTL (30 s). */
export const AUTH_CODE_TTL_MS = 30 * 1000;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Callback: mint a fresh hex code and remember it in this browser. */
export function mintBrowserBoundAuthCode(res: Response): string {
  const code = crypto.randomBytes(32).toString('hex');
  res.cookie(AUTH_CODE_COOKIE, sha256(code), {
    ...linkCookieAttrs(),
    maxAge: AUTH_CODE_TTL_MS,
  });
  return code;
}

/** Constant-time: does this browser hold the cookie minted for `code`? */
export function authCodeBoundToBrowser(req: Request, code: unknown): boolean {
  if (typeof code !== 'string' || code.length === 0) return false;
  const held = readCookie(req, AUTH_CODE_COOKIE);
  if (!held) return false;
  const want = Buffer.from(sha256(code));
  const got = Buffer.from(held);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** Exchange succeeded: the code is spent, drop its cookie. */
export function clearAuthCodeCookie(res: Response): void {
  res.clearCookie(AUTH_CODE_COOKIE, linkCookieAttrs());
}
