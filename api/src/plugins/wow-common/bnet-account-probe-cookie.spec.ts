/**
 * ROK-2322 review MINOR-2: the BNet probe's binding cookie (`rl_bnet_probe_r`)
 * takes the shared auth-cookie Secure rule on set (POST /start) and clear
 * (GET /callback), with identical attributes.
 */
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../auth/types';
import { BnetAccountProbeCallbackController } from './bnet-account-probe-callback.controller';
import { BnetAccountProbeController } from './bnet-account-probe.controller';
import type { BnetAccountProbeService } from './bnet-account-probe.service';
import { BNET_PROBE_COOKIE } from './bnet-account-probe.state';

const LAX = { httpOnly: true, sameSite: 'lax', path: '/' } as const;

function fakeProbe() {
  return {
    start: jest.fn().mockResolvedValue({ url: 'https://x', cookieValue: 'h' }),
    handleCallback: jest.fn().mockResolvedValue('/admin/probe'),
  } as unknown as BnetAccountProbeService;
}

function hop(secure: boolean) {
  const cookie = jest.fn<void, [string, string, unknown]>();
  const clearCookie = jest.fn<void, [string, unknown]>();
  const redirect = jest.fn();
  const req = { user: { id: 7 }, headers: {}, cookies: {}, secure };
  const res = { cookie, clearCookie, redirect, req } as unknown as Response;
  return { req, res, cookie, clearCookie };
}

describe('BNet probe cookie attributes (ROK-2322)', () => {
  const savedClientUrl = process.env.CLIENT_URL;
  afterEach(() => {
    if (savedClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = savedClientUrl;
  });

  it.each([
    ['http CLIENT_URL, plain HTTP', 'http://192.168.0.10:8080', false, false],
    ['http CLIENT_URL, HTTPS request', 'http://192.168.0.10:8080', true, true],
    ['https CLIENT_URL, plain HTTP', 'https://raid.example.net', false, true],
  ])('%s → Secure=%s on set and clear', async (_l, url, secure, want) => {
    process.env.CLIENT_URL = url;
    const start = hop(secure);
    await new BnetAccountProbeController(fakeProbe()).start(
      { region: 'us' },
      start.req as unknown as AuthenticatedRequest,
      start.res,
    );
    expect(start.cookie.mock.calls).toEqual([
      [BNET_PROBE_COOKIE, 'h', { ...LAX, secure: want, maxAge: 600_000 }],
    ]);

    const back = hop(secure);
    await new BnetAccountProbeCallbackController(fakeProbe()).callback(
      {},
      back.req as unknown as Request,
      back.res,
    );
    expect(back.clearCookie.mock.calls).toEqual([
      [BNET_PROBE_COOKIE, { ...LAX, secure: want }],
    ]);
  });
});
