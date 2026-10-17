/**
 * ROK-1755 — `POST /auth/exchange-code` consumes the one-time code
 * atomically: concurrent exchanges of the same code → exactly one token.
 *
 * ROK-1808 — the code exchanges only from the browser holding the
 * `rl_auth_code` cookie (sha256 of the code) the OAuth callback set; a
 * forwarded `/auth/success?code=` link is refused without burning the code.
 */
import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IntentTokenService } from './intent-token.service';
import { UsersService } from '../users/users.service';
import { PreferencesService } from '../users/preferences.service';
import { SignupsService } from '../events/signups.service';
import { CharactersService } from '../characters/characters.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { createRedisMock } from '../common/testing/redis-mock';
import { AUTH_CODE_COOKIE } from './auth-code-cookie.helpers';

const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

async function buildController() {
  const redis = createRedisMock();
  const module = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: {} },
      { provide: IntentTokenService, useValue: {} },
      { provide: UsersService, useValue: {} },
      { provide: PreferencesService, useValue: {} },
      { provide: SignupsService, useValue: {} },
      { provide: CharactersService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: redis.client },
    ],
  }).compile();
  return { controller: module.get(AuthController), redis };
}

/** A browser holding `cookie` (or none) as `rl_auth_code`. */
function browser(cookie?: string) {
  const cookies: Record<string, string> = {};
  if (cookie !== undefined) cookies[AUTH_CODE_COOKIE] = cookie;
  const res = { clearCookie: jest.fn() };
  return {
    req: { headers: {}, cookies } as unknown as Request,
    res: res as unknown as Response,
    clearCookie: res.clearCookie,
  };
}

/** The browser that finished the login for `code`. */
const owner = (code: string) => browser(sha256(code));

describe('AuthController.exchangeCode (ROK-1755)', () => {
  it('concurrent exchanges of one code: exactly one succeeds', async () => {
    const { controller, redis } = await buildController();
    await redis.client.set('auth_code:abc', 'jwt-token', 'EX', 30);
    const b = owner('abc');

    const results = await Promise.allSettled([
      controller.exchangeCode({ code: 'abc' }, b.req, b.res),
      controller.exchangeCode({ code: 'abc' }, b.req, b.res),
      controller.exchangeCode({ code: 'abc' }, b.req, b.res),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(ok).toEqual([
      { status: 'fulfilled', value: { access_token: 'jwt-token' } },
    ]);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(r).toMatchObject({ reason: expect.any(UnauthorizedException) });
    }
    expect(redis.store.has('auth_code:abc')).toBe(false);
  });

  it('a consumed code cannot be exchanged again', async () => {
    const { controller, redis } = await buildController();
    await redis.client.set('auth_code:xyz', 'jwt-2', 'EX', 30);
    const b = owner('xyz');
    await expect(
      controller.exchangeCode({ code: 'xyz' }, b.req, b.res),
    ).resolves.toEqual({ access_token: 'jwt-2' });
    await expect(
      controller.exchangeCode({ code: 'xyz' }, b.req, b.res),
    ).rejects.toThrow('Invalid or expired auth code');
  });
});

describe('AuthController.exchangeCode browser binding (ROK-1808)', () => {
  it('no rl_auth_code cookie: 401 and the code is NOT consumed', async () => {
    const { controller, redis } = await buildController();
    await redis.client.set('auth_code:fwd', 'attacker-jwt', 'EX', 30);
    const victim = browser();
    await expect(
      controller.exchangeCode({ code: 'fwd' }, victim.req, victim.res),
    ).rejects.toThrow('Invalid or expired auth code');
    expect(redis.store.has('auth_code:fwd')).toBe(true);
  });

  it("another code's cookie: 401 and the code is NOT consumed", async () => {
    const { controller, redis } = await buildController();
    await redis.client.set('auth_code:fwd', 'attacker-jwt', 'EX', 30);
    const victim = browser(sha256('victims-own-code'));
    await expect(
      controller.exchangeCode({ code: 'fwd' }, victim.req, victim.res),
    ).rejects.toThrow('Invalid or expired auth code');
    expect(redis.store.has('auth_code:fwd')).toBe(true);
  });

  it('matching cookie: returns the token and clears the cookie', async () => {
    const { controller, redis } = await buildController();
    await redis.client.set('auth_code:mine', 'jwt-3', 'EX', 30);
    const b = owner('mine');
    await expect(
      controller.exchangeCode({ code: 'mine' }, b.req, b.res),
    ).resolves.toEqual({ access_token: 'jwt-3' });
    expect(b.clearCookie).toHaveBeenCalledWith(
      AUTH_CODE_COOKIE,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(redis.store.has('auth_code:mine')).toBe(false);
  });
});
