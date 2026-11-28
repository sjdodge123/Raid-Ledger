/** ROK-2322: the single scheme check behind every auth cookie's Secure flag. */
import {
  browserBoundCookieAttrs,
  configuredClientUrlIsHttps,
  isSecureRequest,
} from './browser-bound-cookie.helpers';

describe('isSecureRequest (ROK-2322)', () => {
  const savedClientUrl = process.env.CLIENT_URL;
  afterEach(() => {
    if (savedClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = savedClientUrl;
  });

  describe('plain-HTTP install (CLIENT_URL http)', () => {
    beforeEach(() => {
      process.env.CLIENT_URL = 'http://192.168.0.10:8080';
    });

    it.each([
      ['an HTTPS request', { secure: true }, true],
      ['a plain HTTP request', { secure: false }, false],
      ['no request at all', undefined, false],
    ])('%s → %s', (_label, req, want) => {
      expect(isSecureRequest(req)).toBe(want);
      expect(browserBoundCookieAttrs(req)).toMatchObject({ secure: want });
    });
  });

  describe('HTTPS deployment (CLIENT_URL https) fails closed', () => {
    beforeEach(() => {
      process.env.CLIENT_URL = 'https://raid.example.net';
    });

    it.each([
      ['an HTTPS request', { secure: true }],
      ['a plain HTTP request (XFP dropped)', { secure: false }],
      ['no request at all', undefined],
    ])('%s → Secure', (_label, req) => {
      expect({ secure: isSecureRequest(req) }).toEqual({ secure: true });
      expect(browserBoundCookieAttrs(req)).toMatchObject({ secure: true });
    });
  });

  it.each([
    ['unset', undefined, false],
    ['blank', '  ', false],
    ['not a URL', 'raid.example.net', false],
    ['http', 'http://localhost:5173', false],
    ['https with a path', 'https://raid.example.net/', true],
  ])('configuredClientUrlIsHttps: %s → %s', (_label, value, want) => {
    if (value === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = value;
    expect(configuredClientUrlIsHttps()).toBe(want);
  });
});
