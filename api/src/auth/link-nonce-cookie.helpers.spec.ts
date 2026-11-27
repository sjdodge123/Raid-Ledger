/**
 * ROK-2322: the link nonce and state cookies' Secure flag follows the
 * request's scheme, not NODE_ENV — on a plain-HTTP all-in-one install
 * (NODE_ENV=production) a Secure cookie was dropped and every account link
 * came back "Link request expired".
 */
import * as crypto from 'crypto';
import type { Request, Response } from 'express';
import {
  consumeBrowserBoundNonce,
  linkCookieAttrs,
  linkNonceCookieName,
  setLinkNonceCookie,
} from './link-nonce-cookie.helpers';
import {
  assertLinkStateBoundToBrowser,
  bindLinkStateToBrowser,
  linkStateCookieName,
} from './link-state-cookie.helpers';
import type { LinkNonceService } from './link-nonce.service';

const LAX = { httpOnly: true, sameSite: 'lax', path: '/' } as const;
const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

/** One browser hop: a request and the response Express pairs with it. */
function hop(secure: boolean, cookies: Record<string, string> = {}) {
  const cookie = jest.fn<void, [string, string, unknown]>();
  const clearCookie = jest.fn<void, [string, unknown]>();
  const req = { headers: {}, cookies, secure } as unknown as Request;
  const res = { cookie, clearCookie, req } as unknown as Response;
  return { req, res, cookie, clearCookie };
}

function only<T extends unknown[]>(m: jest.Mock<void, T>): T {
  const call = m.mock.calls[0];
  if (!call) throw new Error('cookie call missing');
  expect(m.mock.calls).toHaveLength(1);
  return call;
}

describe('link cookie attributes (ROK-2322)', () => {
  const savedEnv = process.env.NODE_ENV;
  const savedClientUrl = process.env.CLIENT_URL;
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    // A plain-HTTP install: only the request's scheme decides Secure.
    process.env.CLIENT_URL = 'http://192.168.0.10:8080';
  });
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
    if (savedClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = savedClientUrl;
  });

  it.each([
    ['plain HTTP under NODE_ENV=production: not Secure', false],
    ['HTTPS request: Secure', true],
  ])('linkCookieAttrs — %s, SameSite Lax', (_label, secure) => {
    expect(linkCookieAttrs({ secure })).toEqual({ ...LAX, secure });
  });

  it('a missing request falls back to the CLIENT_URL rule', () => {
    expect(linkCookieAttrs(undefined)).toEqual({ ...LAX, secure: false });
    process.env.CLIENT_URL = 'https://raid.example.net';
    expect(linkCookieAttrs(undefined)).toEqual({ ...LAX, secure: true });
  });

  it.each([false, true])(
    'nonce cookie (secure=%s): set from res.req, cleared with matching attrs',
    async (secure) => {
      const start = hop(secure);
      setLinkNonceCookie(start.res, 'discord', 'n1');
      const [name, value, setOpts] = only(start.cookie);
      expect(name).toBe(linkNonceCookieName('discord'));
      expect(setOpts).toEqual({ ...LAX, secure, maxAge: 120_000 });

      const back = hop(secure, { [name]: value });
      const consume = jest.fn().mockResolvedValue({ userId: 1 });
      const svc = { consume } as unknown as LinkNonceService;
      await consumeBrowserBoundNonce(svc, 'discord', 'n1', back.req, back.res);
      expect(only(back.clearCookie)).toEqual([name, { ...LAX, secure }]);
    },
  );

  it.each([false, true])(
    'state cookie (secure=%s): set from res.req, cleared with matching attrs',
    (secure) => {
      const start = hop(secure);
      const r = bindLinkStateToBrowser(start.res, 'steam');
      const [name, value, setOpts] = only(start.cookie);
      expect(name).toBe(linkStateCookieName('steam'));
      expect(value).toBe(sha256(r));
      expect(setOpts).toEqual({ ...LAX, secure, maxAge: 600_000 });

      const back = hop(secure, { [name]: value });
      assertLinkStateBoundToBrowser(back.req, back.res, 'steam', r);
      expect(only(back.clearCookie)).toEqual([name, { ...LAX, secure }]);
    },
  );
});
