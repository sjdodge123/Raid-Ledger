import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { TokenBlocklistService } from './token-blocklist.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { clearAuthUserCache } from './auth-user-cache';

let strategy: JwtStrategy;
let mockBlocklist: { isBlocked: jest.Mock };
let mockDb: { select: jest.Mock };

const mockUser = { role: 'member', discordId: '12345' };

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
