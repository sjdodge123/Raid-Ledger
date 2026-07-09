import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as bcrypt from 'bcrypt';
import { LocalAuthService } from './local-auth.service';
import * as schema from '../drizzle/schema';
import { KICK_COOLDOWN_MS } from './auth-status.helpers';

jest.mock('bcrypt');

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Build a db mock whose `select().from().where().limit()` chain resolves the
 * supplied result queue in order (one entry per select call in the method).
 */
function makeDb(results: unknown[][]): Db {
  const limit = jest.fn();
  results.forEach((r) => limit.mockResolvedValueOnce(r));
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  return { select: jest.fn().mockReturnValue({ from }) } as unknown as Db;
}

const mockJwt = {
  sign: jest.fn().mockReturnValue('token'),
} as unknown as JwtService;
const localCred = { passwordHash: 'hash', userId: 5 };

function baseUser(overrides: Record<string, unknown>) {
  return {
    id: 5,
    username: 'target',
    role: 'member',
    discordId: 'd-5',
    avatar: null,
    deactivatedAt: null,
    kickedAt: null,
    kickReason: null,
    bannedAt: null,
    banReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);
});

describe('LocalAuthService.validateCredentials — ban/kick enforcement (ROK-313)', () => {
  it('rejects a banned user with the suspension message', async () => {
    const db = makeDb([[localCred], [baseUser({ bannedAt: new Date() })]]);
    const service = new LocalAuthService(db, mockJwt);

    await expect(
      service.validateCredentials('a@b.com', 'pw'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a kicked user still inside the cooldown', async () => {
    const kickedAt = new Date(Date.now() - 60_000);
    const db = makeDb([[localCred], [baseUser({ kickedAt })]]);
    const service = new LocalAuthService(db, mockJwt);

    await expect(service.validateCredentials('a@b.com', 'pw')).rejects.toThrow(
      /log in again in \d+ minute/,
    );
  });

  it('returns the user for a clean (non-banned, non-kicked) account', async () => {
    const db = makeDb([[localCred], [baseUser({})]]);
    const service = new LocalAuthService(db, mockJwt);

    const user = await service.validateCredentials('a@b.com', 'pw');
    expect(user).toMatchObject({ id: 5, username: 'target' });
  });

  it('allows login once the kick cooldown elapsed (auto-clear)', async () => {
    const kickedAt = new Date(Date.now() - KICK_COOLDOWN_MS - 1);
    // 3rd chain entry is unused; the clear path uses db.update (mocked below).
    const db = makeDb([[localCred], [baseUser({ kickedAt })]]);
    (db as unknown as { update: jest.Mock }).update = jest
      .fn()
      .mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
      });
    const service = new LocalAuthService(db, mockJwt);

    const user = await service.validateCredentials('a@b.com', 'pw');
    expect(user).toMatchObject({ id: 5 });
  });
});

describe('LocalAuthService.impersonate — banned target guard (ROK-313 §9.8)', () => {
  const admin = { id: 1, username: 'admin', role: 'admin' as const };

  it('rejects impersonating a banned account', async () => {
    const db = makeDb([[baseUser({ bannedAt: new Date() })]]);
    const service = new LocalAuthService(db, mockJwt);

    await expect(service.impersonate(admin, 5)).rejects.toThrow(
      'Cannot impersonate a suspended account',
    );
  });

  it('allows impersonating a non-banned member', async () => {
    const db = makeDb([[baseUser({})]]);
    const service = new LocalAuthService(db, mockJwt);

    const result = await service.impersonate(admin, 5);
    expect(result).toMatchObject({ user: { id: 5 } });
  });

  it('still rejects impersonating an admin (UnauthorizedException)', async () => {
    const db = makeDb([[baseUser({ role: 'admin' })]]);
    const service = new LocalAuthService(db, mockJwt);

    await expect(service.impersonate(admin, 5)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
