import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { IntentTokenService } from './intent-token.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type { IntentTokenPayload } from '@raid-ledger/contract';

/**
 * TDD tests for ROK-979: DB-backed intent token single-use enforcement.
 *
 * These tests expect IntentTokenService to inject DrizzleAsyncProvider
 * instead of REDIS_CLIENT, and use a consumedIntentTokens table for
 * single-use tracking via INSERT ... ON CONFLICT DO NOTHING.
 *
 * Expected to FAIL until the implementation is migrated from Redis to Postgres.
 */
describe('IntentTokenService (DB-backed)', () => {
  let service: IntentTokenService;
  let mockDb: MockDb;
  let mockJwtService: {
    sign: jest.Mock;
    verify: jest.Mock;
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

    mockDb = createDrizzleMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentTokenService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    service = module.get<IntentTokenService>(IntentTokenService);
  });

  describe('generate', () => {
    it('should sign a JWT with eventId, discordId, and action', () => {
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
  });

  describe('validate', () => {
    it('should return payload when token is fresh (DB insert succeeds)', async () => {
      // Simulate successful insert — returning() yields a row
      mockDb.returning.mockResolvedValueOnce([{ id: 1 }]);

      const result = await service.validate(mockToken);

      expect(mockJwtService.verify).toHaveBeenCalledWith(mockToken);
      expect(result).toEqual(mockPayload);
      // Verify the service called insert -> values -> onConflictDoNothing -> returning
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.onConflictDoNothing).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
    });

    it('should return null for an already-used token (DB insert returns empty on conflict)', async () => {
      // Simulate ON CONFLICT DO NOTHING — returning() yields empty array
      mockDb.returning.mockResolvedValueOnce([]);

      const result = await service.validate(mockToken);

      expect(mockJwtService.verify).toHaveBeenCalledWith(mockToken);
      expect(result).toBeNull();
    });

    it('should enforce single-use across two calls with the same token', async () => {
      // First call: insert succeeds (fresh token)
      mockDb.returning.mockResolvedValueOnce([{ id: 1 }]);
      // Second call: insert returns empty (conflict — already consumed)
      mockDb.returning.mockResolvedValueOnce([]);

      const first = await service.validate(mockToken);
      const second = await service.validate(mockToken);

      expect(first).toEqual(mockPayload);
      expect(second).toBeNull();
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });

    it('should allow different tokens to validate independently', async () => {
      const token1 = 'token.one.jwt';
      const token2 = 'token.two.jwt';
      const payload1: IntentTokenPayload = {
        ...mockPayload,
        eventId: 1,
      };
      const payload2: IntentTokenPayload = {
        ...mockPayload,
        eventId: 2,
      };

      mockJwtService.verify
        .mockReturnValueOnce(payload1)
        .mockReturnValueOnce(payload2);

      // Both inserts succeed (different token hashes)
      mockDb.returning
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([{ id: 2 }]);

      const result1 = await service.validate(token1);
      const result2 = await service.validate(token2);

      expect(result1).toEqual(payload1);
      expect(result2).toEqual(payload2);
    });

    it('should return null when JWT verification throws (expired)', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('jwt expired');
      });

      const result = await service.validate('expired.token');

      expect(result).toBeNull();
      // Should not attempt DB insert for an invalid JWT
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should return null when JWT verification throws (invalid signature)', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('invalid signature');
      });

      const result = await service.validate('bad.signature.token');

      expect(result).toBeNull();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should hash the token with SHA-256 before storing', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 1 }]);

      await service.validate(mockToken);

      // The values() call should receive an object with a tokenHash field
      // that is a hex-encoded SHA-256 hash (64 characters), NOT the raw JWT
      const valuesCall = mockDb.values.mock.calls[0]?.[0];
      expect(valuesCall).toBeDefined();
      expect(valuesCall).toHaveProperty('tokenHash');
      expect(valuesCall.tokenHash).toHaveLength(64); // SHA-256 hex = 64 chars
      expect(valuesCall.tokenHash).not.toBe(mockToken); // Not the raw JWT
    });

    // ROK-983: DB errors must propagate — not be swallowed by catch-all
    it('should propagate DB errors to the caller (not return null)', async () => {
      const dbError = new Error('Connection refused');

      // JWT verification succeeds, but the DB insert chain throws
      mockDb.returning.mockRejectedValueOnce(dbError);

      // The error must reach the caller — it is NOT a validation failure.
      // Currently FAILS because the catch-all on line 73 swallows it.
      await expect(service.validate(mockToken)).rejects.toThrow(
        'Connection refused',
      );

      // JWT was verified successfully before the DB error occurred
      expect(mockJwtService.verify).toHaveBeenCalledWith(mockToken);
    });

    it('should propagate DB constraint errors to the caller', async () => {
      const constraintError = new Error(
        'duplicate key value violates unique constraint',
      );

      mockDb.returning.mockRejectedValueOnce(constraintError);

      await expect(service.validate(mockToken)).rejects.toThrow(
        'duplicate key value violates unique constraint',
      );
    });
  });
});
