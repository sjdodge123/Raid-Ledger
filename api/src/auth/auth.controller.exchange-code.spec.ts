/**
 * ROK-1755 — `POST /auth/exchange-code` consumes the one-time code
 * atomically: concurrent exchanges of the same code → exactly one token.
 */
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { IntentTokenService } from './intent-token.service';
import { UsersService } from '../users/users.service';
import { PreferencesService } from '../users/preferences.service';
import { SignupsService } from '../events/signups.service';
import { CharactersService } from '../characters/characters.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { createRedisMock } from '../common/testing/redis-mock';

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

describe('AuthController.exchangeCode (ROK-1755)', () => {
  it('concurrent exchanges of one code: exactly one succeeds', async () => {
    const { controller, redis } = await buildController();
    await redis.client.set('auth_code:abc', 'jwt-token', 'EX', 30);

    const results = await Promise.allSettled([
      controller.exchangeCode({ code: 'abc' }),
      controller.exchangeCode({ code: 'abc' }),
      controller.exchangeCode({ code: 'abc' }),
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
    await expect(controller.exchangeCode({ code: 'xyz' })).resolves.toEqual({
      access_token: 'jwt-2',
    });
    await expect(controller.exchangeCode({ code: 'xyz' })).rejects.toThrow(
      'Invalid or expired auth code',
    );
  });
});
