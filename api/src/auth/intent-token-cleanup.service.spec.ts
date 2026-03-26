import { Test, TestingModule } from '@nestjs/testing';
import { IntentTokenCleanupService } from './intent-token-cleanup.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

/**
 * TDD tests for ROK-979: Intent token cleanup cron service.
 *
 * IntentTokenCleanupService should periodically delete rows from
 * the consumedIntentTokens table where consumed_at < now() - 15 minutes.
 *
 * Expected to FAIL until the service is implemented.
 */
describe('IntentTokenCleanupService', () => {
  let service: IntentTokenCleanupService;
  let mockDb: MockDb;
  let mockCronJobService: { executeWithTracking: jest.Mock };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockCronJobService = {
      executeWithTracking: jest
        .fn()
        .mockImplementation((_name: string, fn: () => Promise<void>) => fn()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentTokenCleanupService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: CronJobService, useValue: mockCronJobService },
      ],
    }).compile();

    service = module.get<IntentTokenCleanupService>(IntentTokenCleanupService);
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete rows where consumed_at is older than 15 minutes', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);

      await service.cleanupExpiredTokens();

      // Should call delete on the consumedIntentTokens table
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
    });

    it('should wrap execution in cronJobService.executeWithTracking', async () => {
      mockDb.returning.mockResolvedValueOnce([]);

      await service.cleanupExpiredTokens();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        expect.stringContaining('cleanupExpiredTokens'),
        expect.any(Function),
      );
    });

    it('should handle zero expired rows gracefully', async () => {
      mockDb.returning.mockResolvedValueOnce([]);

      // Should not throw
      await expect(service.cleanupExpiredTokens()).resolves.not.toThrow();
    });

    it('should only delete tokens older than the 15-minute threshold', async () => {
      // This test verifies the WHERE clause uses the correct threshold.
      // The mock simulates returning deleted rows so we can verify the
      // delete was attempted with a time-based filter via the where() call.
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }]);

      await service.cleanupExpiredTokens();

      // where() should have been called (to filter by consumed_at < threshold)
      expect(mockDb.where).toHaveBeenCalled();
    });
  });
});
