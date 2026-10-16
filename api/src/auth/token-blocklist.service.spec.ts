import { Test, TestingModule } from '@nestjs/testing';
import {
  BLOCK_USER_SCRIPT,
  TokenBlocklistService,
  nextBlockStamp,
} from './token-blocklist.service';
import { REDIS_CLIENT } from '../redis/redis.module';

let service: TokenBlocklistService;
let mockRedis: {
  get: jest.Mock;
  set: jest.Mock;
  eval: jest.Mock;
};

async function setupModule(): Promise<void> {
  mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    eval: jest.fn().mockResolvedValue(0),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TokenBlocklistService,
      { provide: REDIS_CLIENT, useValue: mockRedis },
    ],
  }).compile();

  service = module.get<TokenBlocklistService>(TokenBlocklistService);
}

describe('TokenBlocklistService', () => {
  beforeEach(() => setupModule());

  describe('blockUser', () => {
    it('should write the current Unix timestamp through the monotonic script', async () => {
      const before = Math.floor(Date.now() / 1000);
      await service.blockUser(42);
      const after = Math.floor(Date.now() / 1000);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        BLOCK_USER_SCRIPT,
        1,
        'jwt_block:42',
        expect.any(String),
        '86400',
      );

      const now = Number(mockRedis.eval.mock.calls[0]?.[3]);
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(after);
    });

    it('should use 86400 second TTL covering the longest-lived issued JWT (ROK-1353 keeps 24h for rollout safety)', async () => {
      await service.blockUser(1);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        BLOCK_USER_SCRIPT,
        1,
        'jwt_block:1',
        expect.any(String),
        '86400',
      );
    });
  });

  describe('isBlocked', () => {
    it('should return true when token iat is before the block timestamp', async () => {
      mockRedis.get.mockResolvedValue('1700000100');

      const result = await service.isBlocked(42, 1700000050);

      expect(result).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith('jwt_block:42');
    });

    it('should return true when token iat equals the block timestamp', async () => {
      mockRedis.get.mockResolvedValue('1700000100');

      const result = await service.isBlocked(42, 1700000100);

      expect(result).toBe(true);
    });

    it('should return false when token iat is after the block timestamp', async () => {
      mockRedis.get.mockResolvedValue('1700000100');

      const result = await service.isBlocked(42, 1700000200);

      expect(result).toBe(false);
    });

    it('should return false when no block entry exists', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.isBlocked(42, 1700000050);

      expect(result).toBe(false);
    });

    it('should return false and log warning on Redis error (graceful degradation)', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection refused'));

      const result = await service.isBlocked(42, 1700000050);

      expect(result).toBe(false);
    });
  });

  describe('blockUser — Redis error', () => {
    it('should not throw when the Redis write fails', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Connection refused'));

      await expect(service.blockUser(42)).resolves.not.toThrow();
    });
  });
});

describe('ROK-1810 TokenBlocklistService blockUser result + minIatFor', () => {
  beforeEach(() => setupModule());

  it('blockUser resolves true on success and false on a Redis error', async () => {
    await expect(service.blockUser(5)).resolves.toBe(true);
    mockRedis.eval.mockRejectedValueOnce(new Error('down'));
    await expect(service.blockUser(5)).resolves.toBe(false);
  });

  it('minIatFor is the stamp + 1, undefined with no block or on error', async () => {
    mockRedis.get.mockResolvedValueOnce('1792152000');
    await expect(service.minIatFor(5)).resolves.toBe(1792152001);
    await expect(service.minIatFor(5)).resolves.toBeUndefined();
    mockRedis.get.mockRejectedValueOnce(new Error('down'));
    await expect(service.minIatFor(5)).resolves.toBeUndefined();
  });
});

describe('ROK-1810 nextBlockStamp — the monotonic block rule', () => {
  it('is now with no previous stamp (or a garbage one)', () => {
    expect(nextBlockStamp(null, 1792152000)).toBe(1792152000);
    expect(nextBlockStamp('junk', 1792152000)).toBe(1792152000);
  });

  it('is previous + 1 when a block already holds this second or later', () => {
    expect(nextBlockStamp('1792152000', 1792152000)).toBe(1792152001);
    expect(nextBlockStamp('1792152003', 1792152000)).toBe(1792152004);
  });

  it('is now once the clock has passed the previous stamp', () => {
    expect(nextBlockStamp('1792151990', 1792152000)).toBe(1792152000);
  });
});
