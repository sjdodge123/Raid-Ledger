/**
 * ROK-1366 follow-up (PR #1384 review): the signed `steam_link` state is bound
 * to the browser the GET /auth/steam/link hop ran in. A forwarded
 * steamcommunity.com OpenID URL carries the sender's valid state but not the
 * sender's `rl_link_state_steam` cookie, so the callback must refuse it before
 * verifying OpenID or linking (and so before any library sync).
 */
import * as crypto from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

const verifyOpenIdMock = jest.fn();
jest.mock('./steam-http.util', () => ({
  ...jest.requireActual('./steam-http.util'),
  verifySteamOpenId: (...a: unknown[]) => verifyOpenIdMock(...a),
}));

import { SteamAuthController } from './steam-auth.controller';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { SteamService } from './steam.service';
import { SteamWishlistService } from './steam-wishlist.service';
import { LinkNonceService } from '../auth/link-nonce.service';

const SECRET = 'test-secret';
const CLIENT_URL = 'https://raid.test';
const STATE_COOKIE = 'rl_link_state_steam';
const EXPIRED_MSG = encodeURIComponent(
  'Link request expired. Please try again.',
);
const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

interface Mocks {
  consume: jest.Mock;
  isSteamConfigured: jest.Mock;
  getSteamApiKey: jest.Mock;
  linkSteam: jest.Mock;
}

async function build(): Promise<{ ctrl: SteamAuthController; m: Mocks }> {
  const m: Mocks = {
    consume: jest.fn().mockResolvedValue({ userId: 42, returnTo: '/profile' }),
    isSteamConfigured: jest.fn().mockResolvedValue(true),
    getSteamApiKey: jest.fn().mockResolvedValue(null),
    linkSteam: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: (k: string) => ({ JWT_SECRET: SECRET, CLIENT_URL })[k],
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [SteamAuthController],
    providers: [
      { provide: UsersService, useValue: m },
      { provide: SettingsService, useValue: m },
      { provide: ConfigService, useValue: config },
      { provide: LinkNonceService, useValue: { consume: m.consume } },
      { provide: SteamService, useValue: {} },
      { provide: SteamWishlistService, useValue: {} },
    ],
  }).compile();
  return { ctrl: moduleRef.get(SteamAuthController), m };
}

function mockRes(): Response {
  return {
    redirect: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}

function reqWith(cookies?: Record<string, string>): Request {
  return {
    protocol: 'https',
    headers: { host: 'raid.test' },
    query: {},
    cookies,
  } as unknown as Request;
}

const onlyRedirect = (res: Response) =>
  ((res.redirect as jest.Mock).mock.calls as string[][]).map((c) => c[0]);

/** Run the attacker's own GET hop: returns the callback query + the cookie. */
async function hop(ctrl: SteamAuthController) {
  const res = mockRes();
  await ctrl.steamLink('n', reqWith({ rl_link_steam: sha256('n') }), res);
  const [openIdUrl = ''] = onlyRedirect(res);
  const back = new URL(
    new URL(openIdUrl).searchParams.get('openid.return_to') as string,
  );
  const query = { state: back.searchParams.get('state') as string };
  const set = (res.cookie as jest.Mock).mock.calls.find(
    (c: unknown[]) => c[0] === STATE_COOKIE,
  ) as [string, string, Record<string, unknown>] | undefined;
  return { query, set };
}

describe('SteamAuthController — link callback is bound to the hop browser (ROK-1366)', () => {
  let ctrl: SteamAuthController;
  let m: Mocks;

  beforeEach(async () => {
    ({ ctrl, m } = await build());
    verifyOpenIdMock.mockReset().mockResolvedValue('76561190000000001');
  });

  it('the GET hop sets an httpOnly Lax 10-minute cookie of sha256(state.r)', async () => {
    const { query, set } = await hop(ctrl);
    const { data } = JSON.parse(
      Buffer.from(query.state, 'base64').toString(),
    ) as { data: string };
    const r = (JSON.parse(data) as { r?: unknown }).r;

    expect(typeof r).toBe('string');
    expect(set?.[1]).toBe(sha256(r as string));
    expect(set?.[2]).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600_000,
    });
  });

  it.each<[string, Record<string, string> | undefined]>([
    ['no state cookie (a forwarded OpenID URL)', undefined],
    ['a state cookie for a different r', { [STATE_COOKIE]: sha256('other') }],
    ['only the nonce cookie', { rl_link_steam: sha256('n') }],
  ])('rejects %s before OpenID verification or link', async (_l, cookies) => {
    const { query } = await hop(ctrl);
    const res = mockRes();

    await ctrl.steamLinkCallback(query, reqWith(cookies), res);

    expect(onlyRedirect(res)).toEqual([
      `${CLIENT_URL}/profile?steam=error&message=${EXPIRED_MSG}`,
    ]);
    expect(verifyOpenIdMock).not.toHaveBeenCalled();
    expect(m.linkSteam).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('links for the browser holding the matching cookie, then clears it', async () => {
    const { query, set } = await hop(ctrl);
    const res = mockRes();

    await ctrl.steamLinkCallback(
      query,
      reqWith({ [STATE_COOKIE]: set![1] }),
      res,
    );

    expect(m.linkSteam).toHaveBeenCalledWith(42, '76561190000000001');
    expect(onlyRedirect(res)).toEqual([
      `${CLIENT_URL}/profile?steam=success&steam_private=true`,
    ]);
    expect(res.clearCookie).toHaveBeenCalledWith(
      STATE_COOKIE,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });
});
