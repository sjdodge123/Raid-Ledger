import { Test } from '@nestjs/testing';
import { AiRequestLogService } from './ai-request-log.service';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('AiRequestLogService', () => {
  let service: AiRequestLogService;
  let mockDb: ReturnType<typeof createDrizzleMock>;

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    const module = await Test.createTestingModule({
      providers: [
        AiRequestLogService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();
    service = module.get(AiRequestLogService);
  });

  describe('log', () => {
    it('inserts a log entry into the database', async () => {
      mockDb.values.mockReturnThis();
      await service.log({
        feature: 'chat',
        userId: 1,
        provider: 'ollama',
        model: 'llama3.2:3b',
        promptTokens: 10,
        completionTokens: 5,
        latencyMs: 150,
        success: true,
      });
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'chat',
          provider: 'ollama',
          success: true,
        }),
      );
    });
  });

  describe('getUsageStats', () => {
    it('returns aggregated usage statistics', async () => {
      // queryTotals terminates at .where()
      mockDb.where.mockResolvedValueOnce([
        { totalRequests: 100, avgLatencyMs: 150, errorCount: 5 },
      ]);
      // queryTodayCount terminates at .where()
      mockDb.where.mockResolvedValueOnce([{ todayCount: 20 }]);
      // queryByFeature terminates at .groupBy()
      mockDb.groupBy.mockResolvedValueOnce([
        { feature: 'chat', count: 80, avgLatencyMs: 140 },
        { feature: 'categories', count: 20, avgLatencyMs: 180 },
      ]);

      const since = new Date('2026-01-01');
      const stats = await service.getUsageStats(since);
      expect(stats).toMatchObject({
        totalRequests: 100,
        requestsToday: 20,
        avgLatencyMs: 150,
        errorRate: 0.05,
        byFeature: expect.arrayContaining([
          expect.objectContaining({ feature: 'chat', count: 80 }),
        ]),
      });
    });
  });
});
