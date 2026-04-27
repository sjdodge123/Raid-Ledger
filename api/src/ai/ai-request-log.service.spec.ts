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

// — Adversarial tests —

describe('AiRequestLogService (adversarial)', () => {
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

  describe('log — field mapping', () => {
    it('inserts null for optional userId when not provided', async () => {
      mockDb.values.mockReturnThis();
      await service.log({
        feature: 'categories',
        provider: 'ollama',
        model: 'llama3.2:3b',
        latencyMs: 100,
        success: true,
      });
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null }),
      );
    });

    it('inserts null for promptTokens when not provided', async () => {
      mockDb.values.mockReturnThis();
      await service.log({
        feature: 'test',
        provider: 'ollama',
        model: 'llama3.2:3b',
        latencyMs: 50,
        success: false,
      });
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ promptTokens: null }),
      );
    });

    it('inserts null for errorMessage when not provided', async () => {
      mockDb.values.mockReturnThis();
      await service.log({
        feature: 'test',
        provider: 'ollama',
        model: 'llama3.2:3b',
        latencyMs: 50,
        success: true,
      });
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ errorMessage: null }),
      );
    });

    it('inserts provided errorMessage when failure', async () => {
      mockDb.values.mockReturnThis();
      await service.log({
        feature: 'test',
        provider: 'ollama',
        model: 'llama3.2:3b',
        latencyMs: 0,
        success: false,
        errorMessage: 'Connection refused',
      });
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: 'Connection refused',
          success: false,
        }),
      );
    });
  });

  describe('getUsageStats — empty/zero states', () => {
    it('returns errorRate of 0 when totalRequests is 0', async () => {
      mockDb.where.mockResolvedValueOnce([
        { totalRequests: 0, avgLatencyMs: 0, errorCount: 0 },
      ]);
      mockDb.where.mockResolvedValueOnce([{ todayCount: 0 }]);
      mockDb.groupBy.mockResolvedValueOnce([]);

      const stats = await service.getUsageStats(new Date());
      expect(stats.errorRate).toBe(0);
    });

    it('returns empty byFeature array when no feature rows', async () => {
      mockDb.where.mockResolvedValueOnce([
        { totalRequests: 5, avgLatencyMs: 100, errorCount: 0 },
      ]);
      mockDb.where.mockResolvedValueOnce([{ todayCount: 5 }]);
      mockDb.groupBy.mockResolvedValueOnce([]);

      const stats = await service.getUsageStats(new Date());
      expect(stats.byFeature).toEqual([]);
    });

    it('returns zeros when DB returns empty arrays (no rows at all)', async () => {
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.where.mockResolvedValueOnce([]);
      mockDb.groupBy.mockResolvedValueOnce([]);

      const stats = await service.getUsageStats(new Date());
      expect(stats.totalRequests).toBe(0);
      expect(stats.requestsToday).toBe(0);
      expect(stats.avgLatencyMs).toBe(0);
      expect(stats.errorRate).toBe(0);
    });
  });

  describe('getLastSuccessfulChatAt', () => {
    it('returns null when no rows exist for the provider', async () => {
      mockDb.where.mockResolvedValueOnce([{ lastAt: null }]);
      const result = await service.getLastSuccessfulChatAt('claude');
      expect(result).toBeNull();
    });

    it('returns null when no row is returned at all', async () => {
      mockDb.where.mockResolvedValueOnce([]);
      const result = await service.getLastSuccessfulChatAt('claude');
      expect(result).toBeNull();
    });

    it('returns the latest createdAt when successful entries exist', async () => {
      const latest = new Date('2026-04-27T11:55:00.000Z');
      mockDb.where.mockResolvedValueOnce([{ lastAt: latest }]);
      const result = await service.getLastSuccessfulChatAt('claude');
      expect(result).toEqual(latest);
    });
  });
});
