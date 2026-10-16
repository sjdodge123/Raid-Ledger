/**
 * ROK-1808: the Discord login state is browser-bound, expiring and
 * single-use. These drive the helpers and the passport state store against a
 * cookie jar shared by a fake request/response, so "the browser" holds
 * exactly what the response set and nothing else.
 */
import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Metadata } from 'passport-oauth2';
import {
  DiscordLoginStateStore,
  signBrowserBoundLoginState,
  verifyBrowserBoundLoginState,
} from './discord-login-state.helpers';
import { signOAuthState } from './discord-auth.helpers';
import { defined } from '../../common/testing/narrow';

const SECRET = 'jwt-secret';
const COOKIE = 'rl_link_state_discord-login';
const logger = new Logger('spec');
const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

interface Browser {
  jar: Record<string, string>;
  req: Request;
  res: Response;
}

/** A browser: `res.cookie`/`clearCookie` write the jar `req.cookies` reads. */
function browser(): Browser {
  const jar: Record<string, string> = {};
  const res = {
    cookie: jest.fn((name: string, value: string) => {
      jar[name] = value;
    }),
    clearCookie: jest.fn((name: string) => {
      delete jar[name];
    }),
  } as unknown as Response;
  const req = {
    headers: {},
    query: {},
    cookies: jar,
    res,
  } as unknown as Request;
  return { jar, req, res };
}

function decode(state: string): Record<string, unknown> {
  const { data } = JSON.parse(Buffer.from(state, 'base64').toString()) as {
    data: string;
  };
  return JSON.parse(data) as Record<string, unknown>;
}

const opts = { secret: SECRET, logger };
const META: Metadata = {
  authorizationURL: 'https://discord.com/api/oauth2/authorize',
  tokenURL: 'https://discord.com/api/oauth2/token',
  clientID: 'cid',
};

describe('Discord login state (ROK-1808)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('signs r with the payload and sets an httpOnly lax sha256(r) cookie', () => {
    const b = browser();
    const state = signBrowserBoundLoginState(
      b.res,
      { action: 'invite', inviteCode: 'INV' },
      SECRET,
    );
    const data = decode(state);
    expect(data).toMatchObject({ action: 'invite', inviteCode: 'INV' });
    expect(typeof data.r).toBe('string');
    expect(b.jar[COOKIE]).toBe(sha256(String(data.r)));
    expect(b.res.cookie).toHaveBeenCalledWith(
      COOKIE,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
      }),
    );
  });

  it('accepts the state in the browser that minted it and clears the cookie', () => {
    const b = browser();
    const state = signBrowserBoundLoginState(
      b.res,
      { action: 'login' },
      SECRET,
    );
    const check = verifyBrowserBoundLoginState(b.req, b.res, state, opts);
    expect(check).toMatchObject({ ok: true, state: { action: 'login' } });
    expect(b.jar[COOKIE]).toBeUndefined();
  });

  it('refuses a replay of the same state (single use)', () => {
    const b = browser();
    const state = signBrowserBoundLoginState(
      b.res,
      { action: 'login' },
      SECRET,
    );
    verifyBrowserBoundLoginState(b.req, b.res, state, opts);
    expect(verifyBrowserBoundLoginState(b.req, b.res, state, opts)).toEqual({
      ok: false,
      reason: 'state not bound to this browser',
    });
  });

  it('refuses a state forwarded to a browser without the cookie', () => {
    const attacker = browser();
    const state = signBrowserBoundLoginState(
      attacker.res,
      { action: 'login' },
      SECRET,
    );
    const victim = browser();
    expect(
      verifyBrowserBoundLoginState(victim.req, victim.res, state, opts),
    ).toEqual({ ok: false, reason: 'state not bound to this browser' });
  });

  it('refuses a mismatched cookie and leaves it in place', () => {
    const victim = browser();
    signBrowserBoundLoginState(victim.res, { action: 'login' }, SECRET);
    const own = victim.jar[COOKIE];
    const attacker = browser();
    const state = signBrowserBoundLoginState(
      attacker.res,
      { action: 'login' },
      SECRET,
    );
    expect(
      verifyBrowserBoundLoginState(victim.req, victim.res, state, opts),
    ).toMatchObject({ ok: false });
    expect(victim.jar[COOKIE]).toBe(own);
  });

  it('refuses a missing state', () => {
    const b = browser();
    expect(verifyBrowserBoundLoginState(b.req, b.res, undefined, opts)).toEqual(
      { ok: false, reason: 'missing state' },
    );
  });

  it('refuses an expired state even in the minting browser', () => {
    const b = browser();
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const state = signBrowserBoundLoginState(
      b.res,
      { action: 'login' },
      SECRET,
    );
    clock.mockReturnValue(now + 10 * 60 * 1000 + 1);
    expect(verifyBrowserBoundLoginState(b.req, b.res, state, opts)).toEqual({
      ok: false,
      reason: 'invalid or expired state',
    });
  });

  it('refuses a state signed with another secret', () => {
    const b = browser();
    const state = signBrowserBoundLoginState(b.res, { action: 'login' }, 'x');
    expect(verifyBrowserBoundLoginState(b.req, b.res, state, opts)).toEqual({
      ok: false,
      reason: 'invalid or expired state',
    });
  });

  it('refuses a validly signed state with a non-login action (link)', () => {
    const b = browser();
    const r = 'r-value';
    b.jar[COOKIE] = sha256(r);
    const state = signOAuthState(
      { action: 'link', userId: 7, timestamp: Date.now(), r },
      SECRET,
    );
    expect(verifyBrowserBoundLoginState(b.req, b.res, state, opts)).toEqual({
      ok: false,
      reason: 'not a login state',
    });
  });

  it('refuses a pre-ROK-1808 state that carries no r', () => {
    const b = browser();
    const state = signOAuthState(
      { action: 'invite', inviteCode: 'INV', timestamp: Date.now() },
      SECRET,
    );
    expect(verifyBrowserBoundLoginState(b.req, b.res, state, opts)).toEqual({
      ok: false,
      reason: 'state not bound to this browser',
    });
  });
});

describe('DiscordLoginStateStore (ROK-1808)', () => {
  const store = new DiscordLoginStateStore(() => SECRET, logger);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('fails closed with no JWT_SECRET: store errors, verify rejects (m2)', () => {
    const keyless = new DiscordLoginStateStore(() => undefined, logger);
    const b = browser();
    const onStore = jest.fn();
    keyless.store(b.req, META, onStore);
    expect(onStore).toHaveBeenCalledWith(expect.any(Error), undefined);
    expect(b.res.cookie).not.toHaveBeenCalled();
    const state = signOAuthState(
      { action: 'login', timestamp: Date.now(), r: 'x' },
      '',
    );
    const onVerify = jest.fn();
    keyless.verify(b.req, state, META, onVerify);
    expect(onVerify).toHaveBeenCalledWith(expect.any(Error), false, undefined);
  });

  it('has the arities passport-oauth2 dispatches on (store 3, verify 4)', () => {
    expect(store.store.length).toBe(3);
    expect(store.verify.length).toBe(4);
  });

  it('store mints a login state bound to req.res; verify accepts it once', () => {
    const b = browser();
    let minted: unknown;
    store.store(b.req, META, (err, state) => {
      expect(err).toBeNull();
      minted = state;
    });
    const state = String(defined(minted, 'minted state'));
    expect(decode(state)).toMatchObject({ action: 'login' });
    const first = jest.fn();
    store.verify(b.req, state, META, first);
    expect(first).toHaveBeenCalledWith(
      null,
      true,
      expect.objectContaining({ action: 'login' }),
    );
    const second = jest.fn();
    store.verify(b.req, state, META, second);
    expect(second).toHaveBeenCalledWith(null, false, {
      message: 'state not bound to this browser',
    });
  });

  it('verify fails (not errors) when the browser has no cookie', () => {
    const minter = browser();
    let minted = '';
    store.store(minter.req, (_err, state) => {
      minted = String(state);
    });
    const victim = browser();
    const cb = jest.fn();
    store.verify(victim.req, minted, cb);
    expect(cb).toHaveBeenCalledWith(null, false, {
      message: 'state not bound to this browser',
    });
  });
});
