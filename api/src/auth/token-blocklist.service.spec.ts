import { Test, TestingModule } from '@nestjs/testing';
import { TokenBlocklistService } from './token-blocklist.service';
import { REDIS_CLIENT } from '../redis/redis.module';

let service: TokenBlocklistService;
let mockRedis: {
  get: jest.Mock;
  set: jest.Mock;
};

async function setupModule(): Promise<void> {
  mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
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
    it('should set a Redis key with the current Unix timestamp', async () => {
      const before = Math.floor(Date.now() / 1000);
      await service.blockUser(42);
      const after = Math.floor(Date.now() / 1000);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'jwt_block:42',
        expect.any(String),
        'EX',
        86400,
      );

      const storedTimestamp = Number(mockRedis.set.mock.calls[0][1]);
      expect(storedTimestamp).toBeGreaterThanOrEqual(before);
      expect(storedTimestamp).toBeLessThanOrEqual(after);
    });

    it('should use 86400 second TTL matching max token lifetime', async () => {
      await service.blockUser(1);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'jwt_block:1',
        expect.any(String),
        'EX',
        86400,
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
    it('should not throw when Redis set fails', async () => {
      mockRedis.set.mockRejectedValue(new Error('Connection refused'));

      await expect(service.blockUser(42)).resolves.not.toThrow();
    });
  });
});
