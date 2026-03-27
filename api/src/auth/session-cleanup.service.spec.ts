import { Test, TestingModule } from '@nestjs/testing';
import { SessionCleanupService } from './session-cleanup.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

/**
 * TDD tests for ROK-983: Session cleanup uses result.count instead of
 * .returning() + .length for row count logging.
 *
 * The service currently chains .returning({ id: ... }) just to get the
 * count via result.length. This is wasteful -- Drizzle's delete().where()
 * returns { count: N } when .returning() is not chained, which gives
 * the row count without fetching row data.
 *
 * The new test asserts .returning() is NOT called. It will FAIL against
 * the current implementation which uses .returning().
 */
describe('SessionCleanupService', () => {
  let service: SessionCleanupService;
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
        SessionCleanupService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: CronJobService, useValue: mockCronJobService },
      ],
    }).compile();

    service = module.get<SessionCleanupService>(SessionCleanupService);
  });

  describe('cleanupExpiredSessions', () => {
    it('should delete expired sessions via cron', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

      await service.cleanupExpiredSessions();

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('should wrap execution in cronJobService.executeWithTracking', async () => {
      mockDb.returning.mockResolvedValueOnce([]);

      await service.cleanupExpiredSessions();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'SessionCleanupService_cleanupExpiredSessions',
        expect.any(Function),
      );
    });

    it('should handle zero expired sessions gracefully', async () => {
      mockDb.returning.mockResolvedValueOnce([]);

      await expect(
        service.cleanupExpiredSessions(),
      ).resolves.not.toThrow();
    });

    // ROK-983: Use result.count instead of .returning() + .length
    it('should not call .returning() -- use result.count for row count', async () => {
      // Let the chain work normally so the service runs to completion
      mockDb.returning.mockResolvedValueOnce([{ id: 1 }]);

      await service.cleanupExpiredSessions();

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      // .returning() should NOT be called -- the row count is available
      // via result.count without fetching full row data.
      // Currently FAILS because the service chains .returning().
      expect(mockDb.returning).not.toHaveBeenCalled();
    });
  });
});
