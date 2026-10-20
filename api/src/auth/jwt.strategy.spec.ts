import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import {
  clearAuthUserCache,
  getCachedAuthUser,
  invalidateAuthUser,
  setCachedAuthUser,
} from './auth-user-cache';
import { KICK_COOLDOWN_MS } from './auth-status.helpers';
import * as schema from '../drizzle/schema';

let strategy: JwtStrategy;
let mockDb: { select: jest.Mock };

const mockUser = {
  role: 'member',
  discordId: '12345',
  deactivatedAt: null,
  kickedAt: null,
  bannedAt: null,
  banReason: null,
  tokenVersion: 0,
};

/** Rebuild the fluent db.select chain to return a specific user row (or none). */
function mockDbReturns(user: Record<string, unknown> | undefined): void {
  const limit = jest.fn().mockResolvedValue(user ? [user] : []);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  mockDb.select = jest.fn().mockReturnValue({ from });
}

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 1,
    username: 'testuser',
    iat: 1700000000,
    tv: 0,
    ...overrides,
  };
}

async function setupModule(): Promise<void> {
  clearAuthUserCache();

  // Fluent chain: db.select().from().where().limit()
  const mockLimit = jest.fn().mockResolvedValue([mockUser]);
  const mockWhere = jest.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });
  mockDb = {
    select: jest.fn().mockReturnValue({ from: mockFrom }),
  };

  process.env.JWT_SECRET = 'test-secret';

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      JwtStrategy,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();

  strategy = module.get<JwtStrategy>(JwtStrategy);
}

describe('JwtStrategy rejects magic-link tokens (ROK-1366 AC5/D2)', () => {
  beforeEach(setupModule);

  it('throws 401 for a {magicLink:true} payload before any lookup', async () => {
    await expect(
      strategy.validate(buildPayload({ magicLink: true })),
    ).rejects.toThrow(
      new UnauthorizedException('Magic-link tokens are not session tokens'),
    );
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

describe('JwtStrategy — token version claim (ROK-1823 U1)', () => {
  beforeEach(() => setupModule());

  const REVOKED = new UnauthorizedException('Token has been revoked');

  it('accepts tv equal to the cached version and reports it on the user', async () => {
    mockDbReturns({ ...mockUser, tokenVersion: 2 });
    const result = await strategy.validate(buildPayload({ tv: 2 }));
    expect(result).toMatchObject({
      id: 1,
      username: 'testuser',
      tokenVersion: 2,
    });
  });

  it('rejects a stale tv (minted before a bump) with 401 "Token has been revoked"', async () => {
    mockDbReturns({ ...mockUser, tokenVersion: 2 });
    await expect(strategy.validate(buildPayload({ tv: 1 }))).rejects.toThrow(
      REVOKED,
    );
  });

  it('rejects a tv AHEAD of the row (version rolled back) — exact match, fails closed', async () => {
    mockDbReturns({ ...mockUser, tokenVersion: 2 });
    await expect(strategy.validate(buildPayload({ tv: 3 }))).rejects.toThrow(
      REVOKED,
    );
  });

  it('compares against the cached row on a cache hit, without a DB read', async () => {
    setCachedAuthUser(1, { ...mockUser, role: 'member', tokenVersion: 5 });
    await expect(strategy.validate(buildPayload({ tv: 4 }))).rejects.toThrow(
      REVOKED,
    );
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it.each([
    ['missing (minted before ROK-1823)', undefined],
    ['negative', -1],
    ['a float', 1.5],
    ['a numeric string', '2'],
  ])('rejects a tv that is %s before any lookup', async (_label, tv) => {
    await expect(strategy.validate(buildPayload({ tv }))).rejects.toThrow(
      REVOKED,
    );
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should still throw when user no longer exists in DB', async () => {
    // Build a chain that returns empty array (no user)
    const emptyLimit = jest.fn().mockResolvedValue([]);
    const emptyWhere = jest.fn().mockReturnValue({ limit: emptyLimit });
    const emptyFrom = jest.fn().mockReturnValue({ where: emptyWhere });
    mockDb.select = jest.fn().mockReturnValue({ from: emptyFrom });

    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      'User no longer exists',
    );
  });
});

describe('JwtStrategy — ban/kick per-request lockout (ROK-313)', () => {
  beforeEach(() => setupModule());

  it('rejects a banned user with 401 and the suspension reason', async () => {
    mockDbReturns({ ...mockUser, bannedAt: new Date(), banReason: 'cheating' });

    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      'Your account has been suspended: cheating',
    );
  });

  it('rejects a kicked user still inside the cooldown with 401', async () => {
    mockDbReturns({ ...mockUser, kickedAt: new Date(Date.now() - 60_000) });

    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      /log in again in \d+ minute/,
    );
  });

  it('allows a kicked user once the cooldown has elapsed (no auto-clear here)', async () => {
    mockDbReturns({
      ...mockUser,
      kickedAt: new Date(Date.now() - KICK_COOLDOWN_MS - 1),
    });

    const result = await strategy.validate(buildPayload());
    expect(result).toMatchObject({ id: 1, role: 'member' });
  });

  it('rejects a banned user served from the auth cache (cache-hit path)', async () => {
    setCachedAuthUser(1, {
      role: 'member',
      discordId: '12345',
      deactivatedAt: null,
      kickedAt: null,
      bannedAt: new Date(),
      banReason: null,
      tokenVersion: 0,
    });

    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      'Your account has been suspended',
    );
    // Cache short-circuits before the DB.
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

describe('JwtStrategy — non-integer sub is a 401 before any lookup (ROK-1764)', () => {
  beforeEach(setupModule);

  it.each([
    ['missing', undefined],
    ['a numeric string', '1'],
    ['a word', 'abc'],
    ['zero', 0],
    ['negative', -3],
    ['a float', 1.5],
    ['above the int4 users.id range', 2_147_483_648],
  ])('rejects a sub that is %s', async (_label, sub) => {
    await expect(strategy.validate(buildPayload({ sub }))).rejects.toThrow(
      new UnauthorizedException('Invalid session token'),
    );
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('rejects an intent-token payload shape (no sub at all)', async () => {
    const intent = { eventId: 7, discordId: '42', action: 'signup', iat: 1 };
    await expect(
      strategy.validate(intent as unknown as ReturnType<typeof buildPayload>),
    ).rejects.toThrow('Invalid session token');
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

describe('JwtStrategy — deactivated per-request lockout (ROK-1753)', () => {
  beforeEach(setupModule);

  it('rejects a deactivated user with 401 USER_DEACTIVATED', async () => {
    mockDbReturns({ ...mockUser, deactivatedAt: new Date() });
    const err = await strategy.validate(buildPayload()).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toEqual({
      code: 'USER_DEACTIVATED',
      message: 'Account deactivated',
    });
  });

  it('rejects a deactivated user served from the auth cache', async () => {
    setCachedAuthUser(1, {
      ...mockUser,
      role: 'member',
      deactivatedAt: new Date(),
    });
    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      'Account deactivated',
    );
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('lets an admin impersonating a deactivated user through', async () => {
    mockDbReturns({ ...mockUser, deactivatedAt: new Date() });
    // ROK-1754: the impersonator (id 9) is looked up too — an active admin.
    setCachedAuthUser(9, { ...mockUser, role: 'admin' });
    const result = await strategy.validate(
      buildPayload({ impersonatedBy: 9, itv: 0 }),
    );
    expect(result).toMatchObject({ id: 1, impersonatedBy: 9 });
  });

  it('still prefers the ban message for a banned + deactivated user', async () => {
    mockDbReturns({
      ...mockUser,
      deactivatedAt: new Date(),
      bannedAt: new Date(),
    });
    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      'Your account has been suspended',
    );
  });
});

describe('JwtStrategy — impersonator checks on impersonation tokens (ROK-1754)', () => {
  beforeEach(setupModule);

  const ADMIN_ID = 9;
  const impersonation = (over: Record<string, unknown> = {}) =>
    buildPayload({ impersonatedBy: ADMIN_ID, itv: 0, ...over });
  const seedAdmin = (over: Record<string, unknown> = {}) =>
    setCachedAuthUser(ADMIN_ID, { ...mockUser, role: 'admin', ...over });

  it('lets a live operator impersonator through', async () => {
    seedAdmin({ role: 'operator' });
    const result = await strategy.validate(impersonation());
    expect(result).toMatchObject({ id: 1, impersonatedBy: ADMIN_ID });
  });

  it('rejects a stale itv (impersonator bumped, e.g. role change) — ROK-1823 U1', async () => {
    seedAdmin({ tokenVersion: 4 });
    await expect(strategy.validate(impersonation({ itv: 3 }))).rejects.toThrow(
      new UnauthorizedException('Token has been revoked'),
    );
  });

  it('accepts an itv equal to the impersonator version — ROK-1823 U1', async () => {
    seedAdmin({ tokenVersion: 4 });
    await expect(
      strategy.validate(impersonation({ itv: 4 })),
    ).resolves.toMatchObject({ id: 1, impersonatedBy: ADMIN_ID });
  });

  it('rejects impersonatedBy without an itv before any lookup — ROK-1823 U1', async () => {
    seedAdmin();
    await expect(
      strategy.validate(impersonation({ itv: undefined })),
    ).rejects.toThrow(new UnauthorizedException('Token has been revoked'));
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('rejects when the impersonator is banned', async () => {
    seedAdmin({ bannedAt: new Date(), banReason: 'abuse' });
    await expect(strategy.validate(impersonation())).rejects.toThrow(
      'Your account has been suspended',
    );
  });

  it('rejects when the impersonator is deactivated', async () => {
    seedAdmin({ deactivatedAt: new Date() });
    await expect(strategy.validate(impersonation())).rejects.toThrow(
      'Account deactivated',
    );
  });

  it('rejects when the impersonator was demoted below operator', async () => {
    seedAdmin({ role: 'member' });
    await expect(strategy.validate(impersonation())).rejects.toThrow(
      'Impersonation has ended',
    );
  });

  it('does not look the impersonator up for an ordinary token', async () => {
    await strategy.validate(buildPayload());
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });
});

describe('JwtStrategy — token version in the auth-user cache (ROK-1823)', () => {
  beforeEach(() => setupModule());

  it('ROK-1823: loadAuthUser selects token_version and caches it', async () => {
    mockDbReturns({ ...mockUser, tokenVersion: 3 });
    await strategy.validate(buildPayload({ tv: 3 }));
    expect(mockDb.select).toHaveBeenCalledWith(
      expect.objectContaining({ tokenVersion: schema.users.tokenVersion }),
    );
    expect(getCachedAuthUser(1)?.tokenVersion).toBe(3);
  });

  it('ROK-1823: a row loaded across an invalidation is used once, never cached', async () => {
    const limit = jest.fn(() => {
      invalidateAuthUser(1); // a token-version bump commits mid-load
      return Promise.resolve([mockUser]);
    });
    const where = jest.fn().mockReturnValue({ limit });
    mockDb.select = jest.fn().mockReturnValue({ from: () => ({ where }) });
    await expect(strategy.validate(buildPayload())).resolves.toMatchObject({
      id: 1,
    });
    expect(getCachedAuthUser(1)).toBeNull();
  });
});
