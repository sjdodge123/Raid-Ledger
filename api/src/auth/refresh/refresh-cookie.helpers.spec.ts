/**
 * ROK-2322: `rl_rt`'s Secure flag follows the request's scheme, not NODE_ENV.
 * The all-in-one image runs NODE_ENV=production on plain `http://<host>:8080`;
 * a Secure cookie set over HTTP is dropped, so no session survived a reload.
 */
import type { Request, Response } from 'express';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie.helpers';

/** A response paired with its request, as Express pairs them (`res.req`). */
function response(req: Pick<Request, 'secure'> | undefined) {
  const cookie = jest.fn<void, [string, string, unknown]>();
  const clearCookie = jest.fn<void, [string, unknown]>();
  const res = { cookie, clearCookie, req } as unknown as Response;
  return { res, cookie, clearCookie };
}

function setAttrs(c: jest.Mock<void, [string, string, unknown]>): unknown {
  const call = c.mock.calls[0];
  if (!call) throw new Error('res.cookie was not called');
  expect(call[0]).toBe(REFRESH_COOKIE_NAME);
  return call[2];
}

function clearAttrs(c: jest.Mock<void, [string, unknown]>): unknown {
  const call = c.mock.calls[0];
  if (!call) throw new Error('res.clearCookie was not called');
  expect(call[0]).toBe(REFRESH_COOKIE_NAME);
  return call[1];
}

describe('rl_rt refresh cookie attributes (ROK-2322)', () => {
  const savedEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  describe('NODE_ENV=production (the all-in-one image)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it.each([
      ['plain HTTP request: not Secure, SameSite Strict', false],
      ['HTTPS request (TLS or trusted X-Forwarded-Proto): Secure', true],
    ])('%s — and clear matches set', (_label, secure) => {
      const set = response({ secure });
      setRefreshCookie(set.res, 'raw', 60_000);
      const want = { httpOnly: true, secure, sameSite: 'strict', path: '/' };
      expect(setAttrs(set.cookie)).toEqual({ ...want, maxAge: 60_000 });

      const clear = response({ secure });
      clearRefreshCookie(clear.res);
      expect(clearAttrs(clear.clearCookie)).toEqual(want);
    });

    it('never emits SameSite=None (None requires Secure)', () => {
      for (const secure of [false, true]) {
        const set = response({ secure });
        setRefreshCookie(set.res, 'raw', 1);
        expect(setAttrs(set.cookie)).not.toMatchObject({ sameSite: 'none' });
      }
    });

    it('a response without a paired request is treated as plain HTTP', () => {
      const set = response(undefined);
      setRefreshCookie(set.res, 'raw', 1);
      expect(setAttrs(set.cookie)).toMatchObject({ secure: false });
    });
  });

  it('dev keeps SameSite Lax and follows the scheme too', () => {
    process.env.NODE_ENV = 'development';
    const http = response({ secure: false });
    setRefreshCookie(http.res, 'raw', 1);
    expect(setAttrs(http.cookie)).toMatchObject({
      secure: false,
      sameSite: 'lax',
    });
    const https = response({ secure: true });
    setRefreshCookie(https.res, 'raw', 1);
    expect(setAttrs(https.cookie)).toMatchObject({ secure: true });
  });
});
