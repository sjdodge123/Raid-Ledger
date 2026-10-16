/**
 * ROK-1808 — the one-time auth code is bound to the browser that finished
 * the OAuth login via an httpOnly cookie of sha256(code).
 */
import * as crypto from 'crypto';
import type { Request, Response } from 'express';
import {
  AUTH_CODE_COOKIE,
  AUTH_CODE_TTL_MS,
  authCodeBoundToBrowser,
  clearAuthCodeCookie,
  mintBrowserBoundAuthCode,
} from './auth-code-cookie.helpers';

const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

function browser() {
  const jar: Record<string, string> = {};
  const cookie = jest.fn((name: string, value: string) => {
    jar[name] = value;
  });
  const clearCookie = jest.fn((name: string) => {
    delete jar[name];
  });
  return {
    jar,
    cookie,
    clearCookie,
    req: { headers: {}, cookies: jar } as unknown as Request,
    res: { cookie, clearCookie } as unknown as Response,
  };
}

describe('auth-code cookie helpers (ROK-1808)', () => {
  it('mints a 64-char hex code and an httpOnly 30 s cookie of its hash', () => {
    const b = browser();
    const code = mintBrowserBoundAuthCode(b.res);
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(b.cookie).toHaveBeenCalledWith(
      AUTH_CODE_COOKIE,
      sha256(code),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: AUTH_CODE_TTL_MS,
      }),
    );
    expect(AUTH_CODE_TTL_MS).toBe(30_000);
  });

  it('accepts the code only in the browser that minted it', () => {
    const owner = browser();
    const code = mintBrowserBoundAuthCode(owner.res);
    expect(authCodeBoundToBrowser(owner.req, code)).toBe(true);
    expect(authCodeBoundToBrowser(browser().req, code)).toBe(false);
  });

  it('rejects another code, a non-string and an empty code', () => {
    const b = browser();
    mintBrowserBoundAuthCode(b.res);
    expect(authCodeBoundToBrowser(b.req, 'f'.repeat(64))).toBe(false);
    expect(authCodeBoundToBrowser(b.req, undefined)).toBe(false);
    expect(authCodeBoundToBrowser(b.req, '')).toBe(false);
  });

  it('rejects a cookie of the wrong length without throwing', () => {
    const b = browser();
    b.jar[AUTH_CODE_COOKIE] = 'short';
    expect(authCodeBoundToBrowser(b.req, 'abc')).toBe(false);
  });

  it('reads the cookie from the raw header when cookie-parser is absent', () => {
    const code = 'a'.repeat(64);
    const req = {
      headers: { cookie: `x=1; ${AUTH_CODE_COOKIE}=${sha256(code)}` },
    } as unknown as Request;
    expect(authCodeBoundToBrowser(req, code)).toBe(true);
  });

  it('clearAuthCodeCookie drops the cookie with the same attributes', () => {
    const b = browser();
    const code = mintBrowserBoundAuthCode(b.res);
    clearAuthCodeCookie(b.res);
    expect(b.clearCookie).toHaveBeenCalledWith(
      AUTH_CODE_COOKIE,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(authCodeBoundToBrowser(b.req, code)).toBe(false);
  });
});
