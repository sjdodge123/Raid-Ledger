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

/** `secure` is the request scheme Express reports (`req.secure`). */
function browser(secure = false) {
  const jar: Record<string, string> = {};
  const cookie = jest.fn<void, [string, string, unknown?]>((name, value) => {
    jar[name] = value;
  });
  const clearCookie = jest.fn<void, [string, unknown?]>((name) => {
    delete jar[name];
  });
  return {
    jar,
    cookie,
    clearCookie,
    req: { headers: {}, cookies: jar, secure } as unknown as Request,
    res: { cookie, clearCookie } as unknown as Response,
  };
}

describe('auth-code cookie helpers (ROK-1808)', () => {
  it('mints a 64-char hex code and an httpOnly 30 s cookie of its hash', () => {
    const b = browser();
    const code = mintBrowserBoundAuthCode(b.req, b.res);
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
    const code = mintBrowserBoundAuthCode(owner.req, owner.res);
    expect(authCodeBoundToBrowser(owner.req, code)).toBe(true);
    expect(authCodeBoundToBrowser(browser().req, code)).toBe(false);
  });

  it('rejects another code, a non-string and an empty code', () => {
    const b = browser();
    mintBrowserBoundAuthCode(b.req, b.res);
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
    const code = mintBrowserBoundAuthCode(b.req, b.res);
    clearAuthCodeCookie(b.req, b.res);
    expect(b.clearCookie).toHaveBeenCalledWith(
      AUTH_CODE_COOKIE,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(authCodeBoundToBrowser(b.req, code)).toBe(false);
  });
});

describe('auth-code cookie Secure follows the request scheme (Codex r2 P2)', () => {
  const savedEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  it('plain HTTP under NODE_ENV=production: not Secure', () => {
    const b = browser(false);
    mintBrowserBoundAuthCode(b.req, b.res);
    expect(b.cookie).toHaveBeenCalledWith(
      AUTH_CODE_COOKIE,
      expect.any(String),
      expect.objectContaining({ secure: false }),
    );
  });

  it('HTTPS request: Secure', () => {
    const b = browser(true);
    mintBrowserBoundAuthCode(b.req, b.res);
    expect(b.cookie).toHaveBeenCalledWith(
      AUTH_CODE_COOKIE,
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );
  });

  it.each([false, true])(
    'clearing (secure=%s) uses the attributes it was set with, minus maxAge',
    (secure) => {
      const b = browser(secure);
      mintBrowserBoundAuthCode(b.req, b.res);
      clearAuthCodeCookie(b.req, b.res);
      const clearCall = b.clearCookie.mock.calls[0];
      expect(clearCall).toBeDefined();
      expect(clearCall?.[1]).toEqual({
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
      });
    },
  );
});
