import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { TokenBlocklistService } from './token-blocklist.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { clearAuthUserCache, setCachedAuthUser } from './auth-user-cache';
import { KICK_COOLDOWN_MS } from './auth-status.helpers';

let strategy: JwtStrategy;
let mockBlocklist: { isBlocked: jest.Mock };
let mockDb: { select: jest.Mock };

const mockUser = {
  role: 'member',
  discordId: '12345',
  deactivatedAt: null,
  kickedAt: null,
  bannedAt: null,
  banReason: null,
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
    ...overrides,
  };
}

async function setupModule(): Promise<void> {
  clearAuthUserCache();

  mockBlocklist = {
    isBlocked: jest.fn().mockResolvedValue(false),
  };

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
      { provide: TokenBlocklistService, useValue: mockBlocklist },
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();

  strategy = module.get<JwtStrategy>(JwtStrategy);
}

describe('JwtStrategy — blocklist integration', () => {
  beforeEach(() => setupModule());

  it('should allow a valid, non-blocked token', async () => {
    const result = await strategy.validate(buildPayload());

    expect(result).toMatchObject({
      id: 1,
      username: 'testuser',
      role: expect.any(String),
    });
    expect(mockBlocklist.isBlocked).toHaveBeenCalledWith(1, 1700000000);
  });

  it('should reject a blocked token with UnauthorizedException', async () => {
    mockBlocklist.isBlocked.mockResolvedValue(true);

    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      'Token has been revoked',
    );
  });

  it('should check blocklist before database lookup', async () => {
    mockBlocklist.isBlocked.mockResolvedValue(true);

    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      UnauthorizedException,
    );

    // DB select should not have been called since blocklist rejected first
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should pass sub and iat to isBlocked', async () => {
    const payload = buildPayload({ sub: 99, iat: 1700005000 });
    await strategy.validate(payload);

    expect(mockBlocklist.isBlocked).toHaveBeenCalledWith(99, 1700005000);
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
    });

    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      'Your account has been suspended',
    );
    // Cache short-circuits before the DB.
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
