/**
 * ROK-1808: Discord login CSRF. Drives the REAL passport + passport-oauth2
 * pipeline (DiscordAuthGuard -> the strategy registered by reloadConfig ->
 * its state store) and then the controller, against a fake browser whose
 * cookie jar is what the responses set. Only Discord's HTTP edges (token
 * exchange, profile fetch) are stubbed.
 *
 * A callback that arrives without the state cookie of the browser that
 * started the login (a forwarded `?code=&state=` link) must redirect to
 * /login?error=oauth_failed before any code exchange, auth_code write or
 * `rl_rt` cookie.
 */
import * as crypto from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OAuth2 } from 'oauth';
import { Strategy as DiscordPassportStrategy } from 'passport-discord';
import { DiscordAuthController } from './discord-auth.controller';
import { DiscordAuthGuard } from './discord-auth.helpers';
import { DiscordAuthStrategy } from './discord-auth.strategy';
import { AuthService } from '../../auth/auth.service';
import { UsersService } from '../../users/users.service';
import { SettingsService } from '../../settings/settings.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { RefreshTokenService } from '../../auth/refresh/refresh-token.service';
import { LinkNonceService } from '../../auth/link-nonce.service';
import { AUTH_CODE_COOKIE } from '../../auth/auth-code-cookie.helpers';

const SECRET = 'jwt-secret';
const CLIENT_URL = 'https://raid.test';
const STATE_COOKIE = 'rl_link_state_discord-login';
const OAUTH_CONFIG = {
  clientId: 'cid',
  clientSecret: 'shh',
  callbackUrl: 'https://raid.test/api/auth/discord/callback',
};

interface Browser {
  jar: Record<string, string>;
  req: Request;
  res: Response & { location: () => string };
}

function browser(query: Record<string, string> = {}, jar = {}): Browser {
  const cookies: Record<string, string> = jar;
  const headers: Record<string, string> = {};
  const res = {
    headersSent: false,
    statusCode: 200,
    cookie: jest.fn((n: string, v: string) => void (cookies[n] = v)),
    clearCookie: jest.fn((n: string) => void delete cookies[n]),
    setHeader: (n: string, v: string) => void (headers[n] = v),
    end: () => void (res.headersSent = true),
    redirect: jest.fn((url: string) => {
      headers.Location = url;
      res.headersSent = true;
    }),
    location: () => headers.Location ?? '',
  };
  const req = { headers: { host: 'raid.test' }, query, cookies, res };
  (res as { req?: unknown }).req = req;
  return {
    jar: cookies,
    req: req as unknown as Request,
    res: res as unknown as Browser['res'],
  };
}

function ctxFor(b: Browser): ExecutionContext {
  const http = { getRequest: () => b.req, getResponse: () => b.res };
  return {
    switchToHttp: () => http,
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function stateOf(url: string): string {
  const state = new URL(url).searchParams.get('state');
  if (!state) throw new Error(`no state in ${url}`);
  return state;
}

interface Harness {
  ctrl: DiscordAuthController;
  setex: jest.Mock;
  tokenExchange: jest.SpyInstance;
  validate: jest.Mock;
}

type TokenCallback = (err: null, at: string, rt: string, p: object) => void;
function isTokenCallback(v: unknown): v is TokenCallback {
  return typeof v === 'function';
}

async function build(): Promise<Harness> {
  const validate = jest
    .fn()
    .mockResolvedValue({ id: 42, username: 'v', role: 'member' });
  const setex = jest.fn().mockResolvedValue('OK');
  const config = {
    get: (k: string) => ({ JWT_SECRET: SECRET, CLIENT_URL })[k],
  };
  const settings = {
    getDiscordOAuthConfig: jest.fn().mockResolvedValue(OAUTH_CONFIG),
  };
  const auth = {
    validateDiscordUser: validate,
    login: () => ({ access_token: 'jwt' }),
  };
  const refresh = {
    issue: jest.fn().mockResolvedValue({ rawToken: 'rt', maxAgeMs: 1000 }),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [DiscordAuthController],
    providers: [
      DiscordAuthStrategy,
      { provide: AuthService, useValue: auth },
      { provide: UsersService, useValue: {} },
      { provide: ConfigService, useValue: config },
      { provide: SettingsService, useValue: settings },
      { provide: REDIS_CLIENT, useValue: { setex } },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      { provide: RefreshTokenService, useValue: refresh },
      { provide: LinkNonceService, useValue: {} },
    ],
  }).compile();
  await moduleRef.get(DiscordAuthStrategy).reloadConfig();
  const tokenExchange = jest
    .spyOn(OAuth2.prototype, 'getOAuthAccessToken')
    .mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (isTokenCallback(cb)) cb(null, 'at', 'rt', {});
    });
  jest
    .spyOn(DiscordPassportStrategy.prototype, 'userProfile')
    .mockImplementation((_t, done) =>
      done(null, { id: 'd1', username: 'v', avatar: null }),
    );
  return {
    ctrl: moduleRef.get(DiscordAuthController),
    setex,
    tokenExchange,
    validate,
  };
}

/** GET /auth/discord/callback through the guard, then the controller. */
async function callback(h: Harness, b: Browser): Promise<void> {
  await new DiscordAuthGuard().canActivate(ctxFor(b));
  await h.ctrl.discordLoginCallback(
    b.req as Parameters<DiscordAuthController['discordLoginCallback']>[0],
    b.res,
  );
}

/**
 * GET /auth/discord through the guard: the authorize redirect's state. A
 * redirect ends the response without settling passport's promise (as in the
 * real app), so wait for the response to end instead of the guard.
 */
async function startPlainLogin(b: Browser): Promise<string> {
  void new DiscordAuthGuard().canActivate(ctxFor(b));
  for (let i = 0; i < 50 && !b.res.headersSent; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return stateOf(b.res.location());
}

function cookieSet(b: Browser, name: string): boolean {
  const calls = (b.res.cookie as jest.Mock).mock.calls as unknown[][];
  return calls.some((c) => c[0] === name);
}

function refreshCookieSet(b: Browser): boolean {
  return cookieSet(b, 'rl_rt');
}

/** The `?code=` of the success redirect. */
function authCodeOf(b: Browser): string {
  const code = new URL(b.res.location()).searchParams.get('code');
  if (!code) throw new Error(`no code in ${b.res.location()}`);
  return code;
}

function expectRejected(h: Harness, b: Browser): void {
  expect(b.res.location()).toBe(`${CLIENT_URL}/login?error=oauth_failed`);
  expect(h.tokenExchange).not.toHaveBeenCalled();
  expect(h.validate).not.toHaveBeenCalled();
  expect(h.setex).not.toHaveBeenCalled();
  expect(refreshCookieSet(b)).toBe(false);
  expect(cookieSet(b, AUTH_CODE_COOKIE)).toBe(false);
}

describe('Discord login callback state binding (ROK-1808)', () => {
  const envClientUrl = process.env.CLIENT_URL;
  let h: Harness;

  beforeEach(async () => {
    process.env.CLIENT_URL = CLIENT_URL;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    h = await build();
  });

  afterEach(() => {
    process.env.CLIENT_URL = envClientUrl;
    jest.restoreAllMocks();
  });

  it('GET /auth/discord sends a state and sets the state cookie', async () => {
    const start = browser();
    const state = await startPlainLogin(start);
    expect(state.length).toBeGreaterThan(0);
    expect(start.jar[STATE_COOKIE]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('logs in the browser that started it and clears the state cookie', async () => {
    const start = browser();
    const state = await startPlainLogin(start);
    const cb = browser({ code: 'c', state }, start.jar);
    await callback(h, cb);
    expect(cb.res.location()).toMatch(
      /^https:\/\/raid\.test\/auth\/success\?code=[0-9a-f]{64}$/,
    );
    expect(h.setex).toHaveBeenCalledTimes(1);
    expect(refreshCookieSet(cb)).toBe(true);
    expect(cb.jar[STATE_COOKIE]).toBeUndefined();
  });

  it('binds the handed-out auth code to this browser (rl_auth_code)', async () => {
    const start = browser();
    const state = await startPlainLogin(start);
    const cb = browser({ code: 'c', state }, start.jar);
    await callback(h, cb);
    const code = authCodeOf(cb);
    expect(h.setex).toHaveBeenCalledWith(`auth_code:${code}`, 30, 'jwt');
    expect(cb.jar[AUTH_CODE_COOKIE]).toBe(
      crypto.createHash('sha256').update(code).digest('hex'),
    );
  });

  it('rejects a callback with no state at all', async () => {
    const victim = browser({ code: 'attacker-code' });
    await callback(h, victim);
    expectRejected(h, victim);
  });

  it('rejects a forwarded callback: valid state, no state cookie', async () => {
    const attacker = browser();
    const state = await startPlainLogin(attacker);
    const victim = browser({ code: 'attacker-code', state });
    await callback(h, victim);
    expectRejected(h, victim);
  });

  it('rejects a mismatched state cookie', async () => {
    const attacker = browser();
    const state = await startPlainLogin(attacker);
    const victim = browser();
    await startPlainLogin(victim);
    const cb = browser({ code: 'attacker-code', state }, victim.jar);
    await callback(h, cb);
    expectRejected(h, cb);
  });

  it('rejects a replayed callback (state is single-use)', async () => {
    const start = browser();
    const state = await startPlainLogin(start);
    await callback(h, browser({ code: 'c', state }, start.jar));
    h.setex.mockClear();
    h.tokenExchange.mockClear();
    h.validate.mockClear();
    const replay = browser({ code: 'c', state }, start.jar);
    await callback(h, replay);
    expectRejected(h, replay);
  });

  it('invite: routes the bound state to the invite landing', async () => {
    const start = browser();
    await h.ctrl.discordInviteLogin('INV-1', start.req, start.res);
    const state = stateOf(start.res.location());
    const cb = browser({ code: 'c', state }, start.jar);
    await callback(h, cb);
    expect(cb.res.location()).toMatch(
      /\/auth\/success\?code=[0-9a-f]{64}&invite=INV-1$/,
    );
    expect(refreshCookieSet(cb)).toBe(true);
  });

  it('invite: a forwarded invite state is rejected', async () => {
    const attacker = browser();
    await h.ctrl.discordInviteLogin('INV-1', attacker.req, attacker.res);
    const victim = browser({
      code: 'c',
      state: stateOf(attacker.res.location()),
    });
    await callback(h, victim);
    expectRejected(h, victim);
  });

  it('silent: the bound state logs in', async () => {
    const start = browser();
    await h.ctrl.discordSilentLogin('/events', start.req, start.res);
    expect(start.res.location()).toContain('&prompt=none');
    const cb = browser(
      { code: 'c', state: stateOf(start.res.location()) },
      start.jar,
    );
    await callback(h, cb);
    expect(cb.res.location()).toMatch(/\/auth\/success\?code=[0-9a-f]{64}$/);
    expect(refreshCookieSet(cb)).toBe(true);
  });

  it('silent: a forwarded silent state falls through to silent_failed', async () => {
    const attacker = browser();
    await h.ctrl.discordSilentLogin('/events', attacker.req, attacker.res);
    const victim = browser({
      code: 'c',
      state: stateOf(attacker.res.location()),
    });
    await callback(h, victim);
    expect(victim.res.location()).toBe(
      `${CLIENT_URL}/auth/success?silent_failed=1`,
    );
    expect(h.tokenExchange).not.toHaveBeenCalled();
    expect(h.setex).not.toHaveBeenCalled();
    expect(refreshCookieSet(victim)).toBe(false);
  });
});
