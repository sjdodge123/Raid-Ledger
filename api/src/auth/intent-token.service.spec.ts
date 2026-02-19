import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { IntentTokenService } from './intent-token.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { IntentTokenPayload } from '@raid-ledger/contract';

describe('IntentTokenService', () => {
  let service: IntentTokenService;
  let mockJwtService: {
    sign: jest.Mock;
    verify: jest.Mock;
  };

  // Simple Redis mock using a Map to simulate SETNX behavior
  let redisStore: Map<string, string>;
  let mockRedis: {
    set: jest.Mock;
  };

  const mockPayload: IntentTokenPayload = {
    eventId: 42,
    discordId: 'discord-user-123',
    action: 'signup',
  };

  const mockToken = 'signed.jwt.token';

  beforeEach(async () => {
    mockJwtService = {
      sign: jest.fn().mockReturnValue(mockToken),
      verify: jest.fn().mockReturnValue(mockPayload),
    };

    redisStore = new Map();
    mockRedis = {
      // Simulate SETNX: returns 'OK' if key didn't exist, null if it did
      set: jest.fn().mockImplementation((key: string, value: string) => {
        if (redisStore.has(key)) return Promise.resolve(null);
        redisStore.set(key, value);
        return Promise.resolve('OK');
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentTokenService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<IntentTokenService>(IntentTokenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generate', () => {
    it('should call jwtService.sign with correct payload and TTL', () => {
      const token = service.generate(42, 'discord-user-123');

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        { eventId: 42, discordId: 'discord-user-123', action: 'signup' },
        { expiresIn: 15 * 60 },
      );
      expect(token).toBe(mockToken);
    });

    it('should return the signed JWT string', () => {
      const customToken = 'custom.token.value';
      mockJwtService.sign.mockReturnValueOnce(customToken);

      const result = service.generate(1, 'user-abc');

      expect(result).toBe(customToken);
    });

    it('should include eventId and discordId in token payload', () => {
      service.generate(99, 'discord-99');

      const [[payload]] = mockJwtService.sign.mock.calls as [
        [IntentTokenPayload],
      ];
      expect(payload.eventId).toBe(99);
      expect(payload.discordId).toBe('discord-99');
      expect(payload.action).toBe('signup');
    });
  });

  describe('validate', () => {
    it('should return payload for a valid token', async () => {
      const result = await service.validate(mockToken);

      expect(mockJwtService.verify).toHaveBeenCalledWith(mockToken);
      expect(result).toEqual(mockPayload);
    });

    it('should return null for an already-used token (single-use enforcement)', async () => {
      // First use — should succeed
      const first = await service.validate(mockToken);
      expect(first).toEqual(mockPayload);

      // Second use — should be rejected (Redis SETNX returns null)
      const second = await service.validate(mockToken);
      expect(second).toBeNull();
      // Both calls reach verify; second is blocked by Redis SETNX check
      expect(mockJwtService.verify).toHaveBeenCalledTimes(2);
    });

    it('should return null when jwtService.verify throws (expired or invalid)', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('jwt expired');
      });

      const result = await service.validate('expired.token');

      expect(result).toBeNull();
    });

    it('should return null for invalid signature', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('invalid signature');
      });

      const result = await service.validate('bad.signature.token');

      expect(result).toBeNull();
    });

    it('should allow different tokens to be validated independently', async () => {
      const token1 = 'token.one.jwt';
      const token2 = 'token.two.jwt';

      const payload1: IntentTokenPayload = { ...mockPayload, eventId: 1 };
      const payload2: IntentTokenPayload = { ...mockPayload, eventId: 2 };

      mockJwtService.verify
        .mockReturnValueOnce(payload1)
        .mockReturnValueOnce(payload2);

      const result1 = await service.validate(token1);
      const result2 = await service.validate(token2);

      expect(result1).toEqual(payload1);
      expect(result2).toEqual(payload2);
    });

    it('should return payload with correct eventId and discordId', async () => {
      const specificPayload: IntentTokenPayload = {
        eventId: 100,
        discordId: 'disc-456',
        action: 'signup',
      };
      mockJwtService.verify.mockReturnValueOnce(specificPayload);

      const result = await service.validate('some.token');

      expect(result?.eventId).toBe(100);
      expect(result?.discordId).toBe('disc-456');
      expect(result?.action).toBe('signup');
    });
  });
});
