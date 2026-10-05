/**
 * ROK-1366 follow-up (PR #1384 review): the signed `steam_link` state is bound
 * to the browser the GET /auth/steam/link hop ran in. A forwarded
 * steamcommunity.com OpenID URL carries the sender's valid state but not the
 * sender's `rl_link_state_steam` cookie, so the callback must refuse it before
 * verifying OpenID or linking (and so before any library sync).
 *
 * ROK-1731: the callback also validates the assertion locally and burns its
 * response_nonce before Steam is contacted; the link hops are no-store.
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
import { STEAM_OPENID_URL } from './steam-http.util';
import { STEAM_OPENID_NS } from './steam-openid-assertion.helpers';
import { SteamOpenIdNonceStore } from './steam-openid-nonce.store';

const SECRET = 'test-secret';
const CLIENT_URL = 'https://raid.test';
const STATE_COOKIE = 'rl_link_state_steam';
const EXPIRED_MSG = encodeURIComponent(
  'Link request expired. Please try again.',
);
const FAILED_MSG = encodeURIComponent('Steam verification failed');
const CLAIMED = 'https://steamcommunity.com/openid/id/76561190000000001';
const SIGNED =
  'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle';
const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

interface Mocks {
  consume: jest.Mock;
  isSteamConfigured: jest.Mock;
  getSteamApiKey: jest.Mock;
  linkSteam: jest.Mock;
  claim: jest.Mock;
}

/** In-memory stand-in for the Redis SET NX store: true once per nonce. */
function fakeClaim(): jest.Mock {
  const seen = new Set<string>();
  return jest.fn((n: string) => {
    const fresh = !seen.has(n);
    seen.add(n);
    return Promise.resolve(fresh);
  });
}

async function build(): Promise<{ ctrl: SteamAuthController; m: Mocks }> {
  const m: Mocks = {
    consume: jest.fn().mockResolvedValue({ userId: 42, returnTo: '/profile' }),
    isSteamConfigured: jest.fn().mockResolvedValue(true),
    getSteamApiKey: jest.fn().mockResolvedValue(null),
    linkSteam: jest.fn().mockResolvedValue(undefined),
    claim: fakeClaim(),
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
      { provide: SteamOpenIdNonceStore, useValue: { claim: m.claim } },
    ],
  }).compile();
  return { ctrl: moduleRef.get(SteamAuthController), m };
}

function mockRes(): Response {
  return {
    redirect: jest.fn(),
    setHeader: jest.fn(),
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
  const issued = new URL(openIdUrl).searchParams.get(
    'openid.return_to',
  ) as string;
  const query = { state: new URL(issued).searchParams.get('state') as string };
  const set = (res.cookie as jest.Mock).mock.calls.find(
    (c: unknown[]) => c[0] === STATE_COOKIE,
  ) as [string, string, Record<string, unknown>] | undefined;
  return { query, set, issued };
}

const NONCE = `${new Date().toISOString().slice(0, 19)}Zabc123`;

/** A well-formed Steam positive assertion for the hop's issued return_to. */
function assertion(
  hopped: { query: { state: string }; issued: string },
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    state: hopped.query.state,
    'openid.ns': STEAM_OPENID_NS,
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OPENID_URL,
    'openid.claimed_id': CLAIMED,
    'openid.identity': CLAIMED,
    'openid.return_to': hopped.issued,
    'openid.response_nonce': NONCE,
    'openid.assoc_handle': '1234567890',
    'openid.signed': SIGNED,
    'openid.sig': 'c2lnbmF0dXJl',
    ...overrides,
  };
}

/** Hop, then run the callback from the hop browser with `overrides`. */
async function callback(
  ctrl: SteamAuthController,
  overrides: Record<string, string> = {},
) {
  const hopped = await hop(ctrl);
  const res = mockRes();
  await ctrl.steamLinkCallback(
    assertion(hopped, overrides),
    reqWith({ [STATE_COOKIE]: hopped.set![1] }),
    res,
  );
  return res;
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
    const res = await callback(ctrl);

    expect(m.claim).toHaveBeenCalledWith(NONCE);
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

describe('SteamAuthController — OpenID assertion hardening (ROK-1731)', () => {
  let ctrl: SteamAuthController;
  let m: Mocks;
  const failed = `${CLIENT_URL}/profile?steam=error&message=${FAILED_MSG}`;

  beforeEach(async () => {
    ({ ctrl, m } = await build());
    verifyOpenIdMock.mockReset().mockResolvedValue('76561190000000001');
  });

  it.each<[string, Record<string, string>]>([
    [
      'a return_to on another origin',
      {
        'openid.return_to':
          'https://evil.test/auth/steam/link/callback?state=x',
      },
    ],
    ['another op_endpoint', { 'openid.op_endpoint': 'https://evil.test/op' }],
    [
      'a signed list without return_to',
      { 'openid.signed': SIGNED.replace(',return_to', '') },
    ],
  ])('rejects %s before claiming the nonce or contacting Steam', async (_l, o) => {
    const res = await callback(ctrl, o);

    expect(onlyRedirect(res)).toEqual([failed]);
    expect(m.claim).not.toHaveBeenCalled();
    expect(verifyOpenIdMock).not.toHaveBeenCalled();
    expect(m.linkSteam).not.toHaveBeenCalled();
  });

  it('rejects a response_nonce replayed into a second, independent flow', async () => {
    const first = await callback(ctrl);
    const second = await callback(ctrl);

    expect(onlyRedirect(first)).toEqual([
      `${CLIENT_URL}/profile?steam=success&steam_private=true`,
    ]);
    expect(onlyRedirect(second)).toEqual([failed]);
    expect(verifyOpenIdMock).toHaveBeenCalledTimes(1);
    expect(m.linkSteam).toHaveBeenCalledTimes(1);
  });

  it('fails closed with the generic message when the nonce store throws', async () => {
    m.claim.mockRejectedValueOnce(new Error('ECONNREFUSED redis:6379'));

    const res = await callback(ctrl);

    expect(onlyRedirect(res)).toEqual([failed]);
    expect(verifyOpenIdMock).not.toHaveBeenCalled();
    expect(m.linkSteam).not.toHaveBeenCalled();
  });
});

describe('SteamAuthController — link hops are no-store (ROK-1731 AC2)', () => {
  let ctrl: SteamAuthController;
  let m: Mocks;

  beforeEach(async () => {
    ({ ctrl, m } = await build());
    verifyOpenIdMock.mockReset().mockResolvedValue('76561190000000001');
  });

  const expectNoStore = (res: Response) => {
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Referrer-Policy',
      'no-referrer',
    );
  };

  it('GET /link sets them on the OpenID 302 and on the expired 302', async () => {
    const ok = mockRes();
    await ctrl.steamLink('n', reqWith({ rl_link_steam: sha256('n') }), ok);
    m.consume.mockResolvedValueOnce(null);
    const expired = mockRes();
    await ctrl.steamLink('n', reqWith({ rl_link_steam: sha256('n') }), expired);

    expectNoStore(ok);
    expect(onlyRedirect(expired)).toEqual([
      `${CLIENT_URL}/profile/integrations?steam=error&message=${EXPIRED_MSG}`,
    ]);
    expectNoStore(expired);
  });

  it('GET /link/callback sets them on the success and the error 302', async () => {
    const ok = await callback(ctrl);
    const err = await callback(ctrl, { 'openid.mode': 'cancel' });

    expect(onlyRedirect(ok)[0]).toContain('steam=success');
    expectNoStore(ok);
    expect(onlyRedirect(err)[0]).toContain('steam=error');
    expectNoStore(err);
  });
});
