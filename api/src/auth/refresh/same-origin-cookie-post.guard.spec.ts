/**
 * ROK-1755 — decision table for the refresh/logout origin guard.
 */
import {
  ForbiddenException,
  Logger,
  type ExecutionContext,
} from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import {
  CROSS_SITE_REJECTED_MESSAGE,
  SameOriginCookiePostGuard,
  decideCookiePostOrigin,
  parseOriginGuardMode,
  type CookiePostInput,
} from './same-origin-cookie-post.guard';

const HOST = 'raid.gamernight.net';
const base: CookiePostInput = { hostHeader: HOST, isProduction: true };

const cases: Array<[string, Partial<CookiePostInput>, boolean, string]> = [
  ['no headers (non-browser client)', {}, true, 'no-origin'],
  [
    'same-origin, no Origin',
    { secFetchSite: 'same-origin' },
    true,
    'no-origin',
  ],
  [
    'none (user-initiated), no Origin',
    { secFetchSite: 'none' },
    true,
    'no-origin',
  ],
  [
    'same-origin + matching Origin',
    { secFetchSite: 'same-origin', origin: `https://${HOST}` },
    true,
    'origin-allowed',
  ],
  [
    'matching Origin, no Sec-Fetch-Site',
    { origin: `https://${HOST}` },
    true,
    'origin-allowed',
  ],
  [
    'cross-site, no Origin',
    { secFetchSite: 'cross-site' },
    false,
    'cross-site',
  ],
  [
    'cross-site even with a matching Origin',
    { secFetchSite: 'cross-site', origin: `https://${HOST}` },
    false,
    'cross-site',
  ],
  ['Cross-Site casing', { secFetchSite: ' Cross-Site ' }, false, 'cross-site'],
  [
    'same-site sibling host',
    { secFetchSite: 'same-site', origin: 'https://slot-1.gamernight.net' },
    false,
    'origin-mismatch',
  ],
  [
    'same-site without Origin',
    { secFetchSite: 'same-site' },
    false,
    'same-site-no-origin',
  ],
  [
    'mismatched Origin, no Sec-Fetch-Site',
    { origin: 'https://evil.example' },
    false,
    'origin-mismatch',
  ],
  ['Origin: null', { origin: 'null' }, false, 'origin-mismatch'],
  [
    'Origin but no Host header',
    { origin: `https://${HOST}`, hostHeader: undefined },
    false,
    'origin-mismatch',
  ],
  [
    'Origin port differs (nginx strips ports)',
    { origin: `https://${HOST}:8443`, hostHeader: `${HOST}:443` },
    true,
    'origin-allowed',
  ],
  [
    'explicit CORS_ORIGIN match (cross-host staging)',
    {
      origin: 'https://web.example',
      corsOrigin: 'https://web.example',
      secFetchSite: 'same-site',
    },
    true,
    'origin-allowed',
  ],
  [
    'explicit CORS_ORIGIN mismatch',
    { origin: 'https://evil.example', corsOrigin: 'https://web.example' },
    false,
    'origin-mismatch',
  ],
  [
    'CORS_ORIGIN=* never widens the guard',
    { origin: 'https://evil.example', corsOrigin: '*' },
    false,
    'origin-mismatch',
  ],
  [
    'dev localhost Origin outside production',
    {
      origin: 'http://localhost:5173',
      hostHeader: 'api.internal:3000',
      isProduction: false,
    },
    true,
    'origin-allowed',
  ],
  [
    'dev localhost Origin in production',
    { origin: 'http://localhost:5173', hostHeader: 'api.internal:3000' },
    false,
    'origin-mismatch',
  ],
];

describe('decideCookiePostOrigin', () => {
  it.each(cases)('%s', (_label, overrides, allow, reason) => {
    expect(decideCookiePostOrigin({ ...base, ...overrides })).toEqual({
      allow,
      reason,
    });
  });
});

describe('SameOriginCookiePostGuard', () => {
  function contextFor(headers: Record<string, string>): ExecutionContext {
    const req = { headers, method: 'POST', path: '/auth/refresh' };
    return new ExecutionContextHost([req, {}, jest.fn()]);
  }

  it('allows a same-origin request', () => {
    const guard = new SameOriginCookiePostGuard();
    expect(
      guard.canActivate(
        contextFor({
          host: HOST,
          origin: `https://${HOST}`,
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toBe(true);
  });

  it('throws 403 with the cross-site message for a cross-site request', () => {
    const guard = new SameOriginCookiePostGuard();
    const act = () =>
      guard.canActivate(
        contextFor({ host: HOST, 'sec-fetch-site': 'cross-site' }),
      );
    expect(act).toThrow(ForbiddenException);
    expect(act).toThrow(CROSS_SITE_REJECTED_MESSAGE);
  });

  describe('AUTH_ORIGIN_GUARD escape hatch', () => {
    const saved = process.env.AUTH_ORIGIN_GUARD;
    afterEach(() => {
      if (saved === undefined) delete process.env.AUTH_ORIGIN_GUARD;
      else process.env.AUTH_ORIGIN_GUARD = saved;
    });
    const crossSite = () =>
      contextFor({ host: HOST, 'sec-fetch-site': 'cross-site' });

    it('report → logs the would-reject line and allows', () => {
      process.env.AUTH_ORIGIN_GUARD = 'report';
      const guard = new SameOriginCookiePostGuard();
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      expect(guard.canActivate(crossSite())).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('would-reject POST /auth/refresh (cross-site)'),
      );
      warn.mockRestore();
    });

    it('enforce (explicit) still throws 403', () => {
      process.env.AUTH_ORIGIN_GUARD = 'enforce';
      const guard = new SameOriginCookiePostGuard();
      expect(() => guard.canActivate(crossSite())).toThrow(ForbiddenException);
    });
  });
});

describe('parseOriginGuardMode', () => {
  it.each([
    [undefined, 'enforce'],
    ['', 'enforce'],
    ['enforce', 'enforce'],
    ['report', 'report'],
    [' REPORT ', 'report'],
    ['off', 'enforce'],
  ])('%p → %s', (raw, mode) => {
    expect(parseOriginGuardMode(raw)).toBe(mode);
  });
});
