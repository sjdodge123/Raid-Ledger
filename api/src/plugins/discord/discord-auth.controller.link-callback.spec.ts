/**
 * ROK-1366 follow-up (PR #1384 review): the signed link state is bound to the
 * browser the GET /auth/discord/link hop ran in. A forwarded discord.com
 * authorize URL carries the sender's valid state but not the sender's
 * `rl_link_state_discord` cookie, so the callback must refuse it before any
 * code exchange or link.
 */
import * as crypto from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Request, Response } from 'express';

const exchangeMock = jest.fn();
const profileMock = jest.fn();
jest.mock('./discord-auth.helpers', () => ({
  ...jest.requireActual('./discord-auth.helpers'),
  exchangeCodeForToken: (...a: unknown[]) => exchangeMock(...a),
  fetchDiscordProfile: (...a: unknown[]) => profileMock(...a),
}));

import { DiscordAuthController } from './discord-auth.controller';
import { signOAuthState } from './discord-auth.helpers';
import { AuthService } from '../../auth/auth.service';
import { UsersService } from '../../users/users.service';
import { SettingsService } from '../../settings/settings.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { RefreshTokenService } from '../../auth/refresh/refresh-token.service';
import { LinkNonceService } from '../../auth/link-nonce.service';

const SECRET = 'test-secret';
const CLIENT_URL = 'https://raid.test';
const STATE_COOKIE = 'rl_link_state_discord';
const EXPIRED_LANDING = `${CLIENT_URL}/profile?linked=error&message=${encodeURIComponent('Link request expired. Please try again.')}`;
const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

interface Mocks {
  consume: jest.Mock;
  getDiscordOAuthConfig: jest.Mock;
  linkDiscord: jest.Mock;
  findByDiscordIdIncludingUnlinked: jest.Mock;
  emit: jest.Mock;
}

async function build(): Promise<{ ctrl: DiscordAuthController; m: Mocks }> {
  const m: Mocks = {
    consume: jest.fn().mockResolvedValue({ userId: 7 }),
    getDiscordOAuthConfig: jest.fn().mockResolvedValue({
      clientId: 'cid',
      clientSecret: 'shh',
      callbackUrl: 'https://raid.test/api/auth/discord/callback',
    }),
    linkDiscord: jest.fn().mockResolvedValue(undefined),
    findByDiscordIdIncludingUnlinked: jest.fn().mockResolvedValue(null),
    emit: jest.fn(),
  };
  const config = {
    get: (k: string) => ({ JWT_SECRET: SECRET, CLIENT_URL })[k],
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [DiscordAuthController],
    providers: [
      { provide: AuthService, useValue: {} },
      { provide: UsersService, useValue: m },
      { provide: ConfigService, useValue: config },
      { provide: SettingsService, useValue: m },
      { provide: REDIS_CLIENT, useValue: {} },
      { provide: EventEmitter2, useValue: m },
      { provide: RefreshTokenService, useValue: {} },
      { provide: LinkNonceService, useValue: { consume: m.consume } },
    ],
  }).compile();
  return { ctrl: moduleRef.get(DiscordAuthController), m };
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
    headers: { host: 'raid.test' },
    query: {},
    cookies,
  } as unknown as Request;
}

const onlyRedirect = (res: Response) =>
  ((res.redirect as jest.Mock).mock.calls as string[][]).map((c) => c[0]);

/** Run the attacker's own GET hop: returns the state + the cookie it set. */
async function hop(ctrl: DiscordAuthController) {
  const res = mockRes();
  await ctrl.discordLink('n', reqWith({ rl_link_discord: sha256('n') }), res);
  const [authorizeUrl] = onlyRedirect(res);
  const state = new URL(authorizeUrl).searchParams.get('state') as string;
  const set = (res.cookie as jest.Mock).mock.calls.find(
    (c: unknown[]) => c[0] === STATE_COOKIE,
  ) as [string, string, Record<string, unknown>] | undefined;
  return { state, set };
}

describe('DiscordAuthController — link callback is bound to the hop browser (ROK-1366)', () => {
  let ctrl: DiscordAuthController;
  let m: Mocks;

  beforeEach(async () => {
    ({ ctrl, m } = await build());
    exchangeMock.mockReset().mockResolvedValue({ access_token: 'at' });
    profileMock
      .mockReset()
      .mockResolvedValue({ id: 'victim-d', username: 'v' });
  });

  it('the GET hop sets an httpOnly Lax 10-minute cookie of sha256(state.r)', async () => {
    const { state, set } = await hop(ctrl);
    const { data } = JSON.parse(Buffer.from(state, 'base64').toString()) as {
      data: string;
    };
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
    ['no state cookie (a forwarded authorize URL)', undefined],
    ['a state cookie for a different r', { [STATE_COOKIE]: sha256('other') }],
    ['only the nonce cookie', { rl_link_discord: sha256('n') }],
  ])('rejects %s before any code exchange or link', async (_l, cookies) => {
    const { state } = await hop(ctrl);
    const res = mockRes();

    await ctrl.discordLinkCallback('code', state, reqWith(cookies), res);

    expect(onlyRedirect(res)).toEqual([EXPIRED_LANDING]);
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(m.linkDiscord).not.toHaveBeenCalled();
    expect(m.emit).not.toHaveBeenCalled();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('rejects a signed state that carries no r (minted before the binding)', async () => {
    const state = signOAuthState(
      { userId: 7, action: 'link', timestamp: Date.now() },
      SECRET,
    );
    const res = mockRes();

    await ctrl.discordLinkCallback('code', state, reqWith({}), res);

    expect(onlyRedirect(res)).toEqual([EXPIRED_LANDING]);
    expect(m.linkDiscord).not.toHaveBeenCalled();
  });

  it('links for the browser holding the matching cookie, then clears it', async () => {
    const { state, set } = await hop(ctrl);
    const res = mockRes();

    await ctrl.discordLinkCallback(
      'code',
      state,
      reqWith({ [STATE_COOKIE]: set![1] }),
      res,
    );

    expect(onlyRedirect(res)).toEqual([`${CLIENT_URL}/profile?linked=success`]);
    expect(m.linkDiscord).toHaveBeenCalledWith(7, 'victim-d', 'v', undefined);
    expect(res.clearCookie).toHaveBeenCalledWith(
      STATE_COOKIE,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });
});
