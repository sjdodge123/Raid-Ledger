/**
 * Tests for ItadPriceSyncService (ROK-818, ROK-987, ROK-1197).
 * Verifies cron-based ITAD pricing sync behavior.
 */
jest.mock('../common/perf-logger', () => ({
  ...jest.requireActual('../common/perf-logger'),
  perfLog: jest.fn(),
  isPerfEnabled: jest.fn(() => true),
}));

import { Test } from '@nestjs/testing';
import {
  ItadPriceSyncService,
  buildUpdateData,
} from './itad-price-sync.service';
import { ItadPriceService } from './itad-price.service';
import { ItadService } from './itad.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { perfLog } from '../common/perf-logger';
import type { ItadOverviewGameEntry } from './itad-price.types';

describe('ItadPriceSyncService', () => {
  let service: ItadPriceSyncService;
  let mockDb: MockDb;
  let mockItadPriceService: { getOverviewBatch: jest.Mock };
  let mockItadService: { getGameInfo: jest.Mock };
  let mockCronJobService: { executeWithTracking: jest.Mock };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockItadPriceService = { getOverviewBatch: jest.fn() };
    mockItadService = { getGameInfo: jest.fn().mockResolvedValue(null) };
    mockCronJobService = {
      executeWithTracking: jest
        .fn()
        .mockImplementation((_name: string, fn: () => Promise<void>) => fn()),
    };

    const module = await Test.createTestingModule({
      providers: [
        ItadPriceSyncService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: ItadPriceService, useValue: mockItadPriceService },
        { provide: ItadService, useValue: mockItadService },
        { provide: CronJobService, useValue: mockCronJobService },
      ],
    }).compile();

    service = module.get(ItadPriceSyncService);
  });

  describe('syncPricing', () => {
    it('skips when no games have itadGameId', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await service.syncPricing();

      expect(mockItadPriceService.getOverviewBatch).not.toHaveBeenCalled();
    });

    it('fetches pricing and updates games in DB', async () => {
      const games = [
        { id: 1, itadGameId: 'game-uuid-1' },
        { id: 2, itadGameId: 'game-uuid-2' },
      ];
      // select query returns games with itadGameId
      mockDb.where.mockResolvedValueOnce(games);

      const entries: ItadOverviewGameEntry[] = [
        {
          id: 'game-uuid-1',
          current: {
            shop: { id: 1, name: 'Steam' },
            price: { amount: 9.99, amountInt: 999, currency: 'USD' },
            regular: { amount: 39.99, amountInt: 3999, currency: 'USD' },
            cut: 75,
            url: 'https://store.steampowered.com/app/1',
          },
          lowest: {
            shop: { id: 1, name: 'Steam' },
            price: { amount: 4.99, amountInt: 499, currency: 'USD' },
            regular: { amount: 39.99, amountInt: 3999, currency: 'USD' },
            cut: 88,
            timestamp: '2025-12-25T00:00:00Z',
          },
          bundled: 0,
          urls: { game: 'https://isthereanydeal.com/game/test1/' },
        },
      ];
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce(entries);
      // stale-pricing returning (clearStalePricing)
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledWith([
        'game-uuid-1',
        'game-uuid-2',
      ]);

      // Verify bulk pricing update was executed via db.execute()
      expect(mockDb.execute).toHaveBeenCalled();

      // Verify buildUpdateData produces the correct pricing shape
      const data = buildUpdateData(entries[0], new Date());
      expect(data).toMatchObject({
        itadCurrentPrice: '9.99',
        itadCurrentCut: 75,
        itadCurrentShop: 'Steam',
        itadCurrentUrl: 'https://store.steampowered.com/app/1',
        itadLowestPrice: '4.99',
        itadLowestCut: 88,
        itadPriceUpdatedAt: expect.any(String),
      });
    });

    it('chunks games into batches of 50', async () => {
      const games = Array.from({ length: 75 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      mockItadPriceService.getOverviewBatch.mockResolvedValue([]);

      await service.syncPricing();

      // Should be called twice: first 50, then remaining 25
      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledTimes(2);
      const firstCall = mockItadPriceService.getOverviewBatch.mock
        .calls[0][0] as string[];
      const secondCall = mockItadPriceService.getOverviewBatch.mock
        .calls[1][0] as string[];
      expect(firstCall).toHaveLength(50);
      expect(secondCall).toHaveLength(25);
    });

    it('continues processing on partial chunk failure', async () => {
      const games = Array.from({ length: 75 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      mockItadPriceService.getOverviewBatch
        .mockRejectedValueOnce(new Error('ITAD 429'))
        .mockResolvedValueOnce([]);

      await service.syncPricing();

      // Both chunks attempted despite first failing
      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('scheduledSync', () => {
    it('delegates to cronJobService.executeWithTracking', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await service.scheduledSync();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'ItadPriceSyncService_syncPricing',
        expect.any(Function),
      );
    });
  });

  describe('ROK-987: itadPriceUpdatedAt must be ISO string', () => {
    const sampleEntry: ItadOverviewGameEntry = {
      id: 'game-uuid-1',
      current: {
        shop: { id: 1, name: 'Steam' },
        price: { amount: 19.99, amountInt: 1999, currency: 'USD' },
        regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
        cut: 67,
        url: 'https://store.steampowered.com/app/1',
      },
      lowest: {
        shop: { id: 1, name: 'Steam' },
        price: { amount: 9.99, amountInt: 999, currency: 'USD' },
        regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
        cut: 83,
        timestamp: '2025-06-01T00:00:00Z',
      },
      bundled: 0,
      urls: { game: 'https://isthereanydeal.com/game/test/' },
    };

    it('buildUpdateData returns a string for itadPriceUpdatedAt', () => {
      const now = new Date('2026-03-27T12:00:00Z');
      const data = buildUpdateData(sampleEntry, now);

      // Must be a string, not a Date instance
      expect(typeof data.itadPriceUpdatedAt).toBe('string');
      expect(data.itadPriceUpdatedAt).not.toBeInstanceOf(Date);
    });

    it('buildUpdateData itadPriceUpdatedAt is an ISO 8601 string, not a Date', () => {
      const now = new Date('2026-03-27T12:00:00.000Z');
      const data = buildUpdateData(sampleEntry, now);

      // Must be a primitive string, not a Date object
      expect(typeof data.itadPriceUpdatedAt).toBe('string');
      // Must contain the expected ISO timestamp
      expect(data.itadPriceUpdatedAt).toBe('2026-03-27T12:00:00.000Z');
    });

    it('ItadPricingData.itadPriceUpdatedAt flows as string through executeBulkPricingUpdate', () => {
      const now = new Date('2026-03-27T12:00:00.000Z');
      const data = buildUpdateData(sampleEntry, now);

      // The value produced by buildUpdateData must be a string
      // so it can be safely interpolated into the sql template.
      // If it's still a Date, this assertion fails.
      const row = { id: 1, ...data };
      expect(typeof row.itadPriceUpdatedAt).toBe('string');
    });
  });

  // ─── ROK-1197: earlyAccess phase split + degraded status ────────────────
  describe('ROK-1197: earlyAccess phase logging + telemetry', () => {
    /**
     * Helper to seed two chunks worth of games (75 games → chunks of 50 + 25)
     * so the per-chunk log assertions have multiple chunks to count.
     */
    function seedTwoChunks(): { id: number; itadGameId: string }[] {
      const games = Array.from({ length: 75 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      mockItadPriceService.getOverviewBatch.mockResolvedValue([]);
      mockDb.returning.mockResolvedValue([]);
      return games;
    }

    beforeEach(() => {
      (perfLog as jest.Mock).mockClear();
    });

    it('AC #1: emits a per-chunk DEBUG log for each earlyAccess chunk', async () => {
      seedTwoChunks();
      // Every getGameInfo succeeds with a valid result so each chunk is processed.
      mockItadService.getGameInfo.mockResolvedValue({ earlyAccess: false });

      const debugSpy = jest.spyOn(service['logger'], 'debug');

      await service.syncPricing();

      // 75 games / 50 per chunk = 2 earlyAccess chunks → 2 per-chunk debug logs.
      // Today the service only emits a single post-loop "Updated earlyAccess for N games"
      // (and pricing-chunk debug logs), so this assertion fails.
      const earlyChunkLogs = debugSpy.mock.calls.filter((c) =>
        /Updated earlyAccess for chunk of \d+ games/i.test(String(c[0])),
      );
      expect(earlyChunkLogs.length).toBeGreaterThanOrEqual(2);
    });

    it('AC #2: emits a dedicated PERF entry for the earlyAccess phase', async () => {
      seedTwoChunks();
      mockItadService.getGameInfo.mockResolvedValue({ earlyAccess: false });

      await service.syncPricing();

      const operations = (perfLog as jest.Mock).mock.calls.map(
        (c) => c[1] as string,
      );
      // Today only the wrapper's single PERF call is emitted (and that goes
      // through the real perfLog from helpers, NOT through this mocked import).
      // The service must emit its own perfLog('CRON', '..._earlyAccess', …) for
      // Phase B. This assertion fails until the service does so.
      expect(operations).toEqual(
        expect.arrayContaining(['ItadPriceSyncService_earlyAccess']),
      );
    });

    it('AC #3: post-pricing log message says "pricing phase complete", not "pricing sync complete"', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 1, itadGameId: 'game-uuid-1' },
      ]);
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValue([]);
      mockItadService.getGameInfo.mockResolvedValue({ earlyAccess: false });

      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.syncPricing();

      const messages = logSpy.mock.calls.map((c) => String(c[0]));
      // The misleading "pricing sync complete" log must be renamed.
      expect(
        messages.some((m) => /pricing phase complete/i.test(m)),
      ).toBe(true);
      expect(
        messages.some((m) => /pricing sync complete/i.test(m)),
      ).toBe(false);
    });

    it('AC #5: signals degraded status to the cron wrapper when getGameInfo failures occur', async () => {
      // Two earlyAccess chunks (50 + 25). Half of the calls reject → at least
      // one chunk has failures > 0, so the run must be flagged degraded.
      seedTwoChunks();
      let call = 0;
      mockItadService.getGameInfo.mockImplementation(() => {
        call++;
        return call % 2 === 0
          ? Promise.reject(new Error('upstream slow'))
          : Promise.resolve({ earlyAccess: false });
      });

      // Capture what syncPricing returns to executeWithTracking. The wrapper's
      // contract today is Promise<void | boolean>; ROK-1197 extends it so a
      // degraded run returns { degraded: true } (or equivalent shape that
      // surfaces a non-completed status to the wrapper).
      mockCronJobService.executeWithTracking.mockImplementationOnce(
        async (_name: string, fn: () => Promise<unknown>) => {
          const result = await fn();
          // Stash on the mock so the assertion below can read it.
          (mockCronJobService.executeWithTracking as jest.Mock & {
            lastResult?: unknown;
          }).lastResult = result;
        },
      );

      await service.scheduledSync();

      const lastResult = (
        mockCronJobService.executeWithTracking as jest.Mock & {
          lastResult?: unknown;
        }
      ).lastResult;

      // Either: the inner fn returned a degraded marker the wrapper can act on,
      // OR the service emitted a perfLog with status=degraded directly.
      const fnSignaledDegraded =
        typeof lastResult === 'object' &&
        lastResult !== null &&
        (lastResult as { degraded?: unknown }).degraded === true;

      const perfLoggedDegraded = (perfLog as jest.Mock).mock.calls.some(
        (c) => {
          const meta = c[3] as Record<string, unknown> | undefined;
          return meta?.status === 'degraded';
        },
      );

      expect(fnSignaledDegraded || perfLoggedDegraded).toBe(true);
    });
  });
});
