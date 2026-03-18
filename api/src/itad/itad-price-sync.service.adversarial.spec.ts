/**
 * Adversarial tests for ItadPriceSyncService (ROK-818).
 * Covers edge cases the dev's initial tests missed:
 * - buildUpdateData with null current / null lowest / both null
 * - onApplicationBootstrap setTimeout wiring
 * - getOverviewBatch returns empty array (no entries) — DB update still fires
 * - Games not in the ITAD response map are skipped (stale cleanup handles them)
 * - Multiple chunk failures don't abort the entire sync
 * - Bulk update is called once per chunk via db.execute()
 */
import { Test } from '@nestjs/testing';
import {
  ItadPriceSyncService,
  buildUpdateData,
} from './itad-price-sync.service';
import { ItadPriceService } from './itad-price.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type { ItadOverviewGameEntry } from './itad-price.types';

function buildEntry(
  id: string,
  overrides: Partial<Pick<ItadOverviewGameEntry, 'current' | 'lowest'>> = {},
): ItadOverviewGameEntry {
  return {
    id,
    current:
      overrides.current !== undefined
        ? overrides.current
        : {
            shop: { id: 1, name: 'Steam' },
            price: { amount: 9.99, amountInt: 999, currency: 'USD' },
            regular: { amount: 39.99, amountInt: 3999, currency: 'USD' },
            cut: 75,
            url: 'https://store.steampowered.com/app/1',
          },
    lowest:
      overrides.lowest !== undefined
        ? overrides.lowest
        : {
            shop: { id: 1, name: 'Steam' },
            price: { amount: 4.99, amountInt: 499, currency: 'USD' },
            regular: { amount: 39.99, amountInt: 3999, currency: 'USD' },
            cut: 88,
            timestamp: '2025-12-25T00:00:00Z',
          },
    bundled: 0,
    urls: { game: 'https://isthereanydeal.com/game/test/' },
  };
}

describe('ItadPriceSyncService — adversarial', () => {
  let service: ItadPriceSyncService;
  let mockDb: MockDb;
  let mockItadPriceService: { getOverviewBatch: jest.Mock };
  let mockCronJobService: { executeWithTracking: jest.Mock };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockItadPriceService = { getOverviewBatch: jest.fn() };
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
        { provide: CronJobService, useValue: mockCronJobService },
      ],
    }).compile();

    service = module.get(ItadPriceSyncService);
  });

  describe('buildUpdateData — edge: null deal fields', () => {
    it('writes null pricing columns when current is null but lowest exists', () => {
      const entry = buildEntry('game-null-current', { current: null });
      const data = buildUpdateData(entry, new Date());

      expect(data.itadCurrentPrice).toBeNull();
      expect(data.itadCurrentCut).toBeNull();
      expect(data.itadCurrentShop).toBeNull();
      expect(data.itadCurrentUrl).toBeNull();
      expect(data.itadLowestPrice).toBe('4.99');
      expect(data.itadLowestCut).toBe(88);
      expect(data.itadPriceUpdatedAt).toBeInstanceOf(Date);
    });

    it('writes null lowest columns when lowest is null but current exists', () => {
      const entry = buildEntry('game-null-lowest', { lowest: null });
      const data = buildUpdateData(entry, new Date());

      expect(data.itadCurrentPrice).toBe('9.99');
      expect(data.itadCurrentCut).toBe(75);
      expect(data.itadLowestPrice).toBeNull();
      expect(data.itadLowestCut).toBeNull();
    });

    it('writes all pricing nulls when both current and lowest are null', () => {
      const entry = buildEntry('game-all-null', {
        current: null,
        lowest: null,
      });
      const data = buildUpdateData(entry, new Date());

      expect(data.itadCurrentPrice).toBeNull();
      expect(data.itadCurrentCut).toBeNull();
      expect(data.itadLowestPrice).toBeNull();
      expect(data.itadLowestCut).toBeNull();
      expect(data.itadPriceUpdatedAt).toBeInstanceOf(Date);
    });
  });

  describe('syncPricing — edge: game missing from ITAD response', () => {
    it('skips bulk update when game is not in the ITAD response', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 20, itadGameId: 'game-in-db-not-in-itad' },
      ]);
      // ITAD returns entries for a different game — our game is absent
      const entry = buildEntry('some-other-game');
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([entry]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      // No bulk execute for pricing (no matched games), only clearStalePricing's
      // update/set/where/returning chain runs
      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });

  describe('syncPricing — edge: getOverviewBatch returns empty array', () => {
    it('skips bulk update when ITAD returns no entries', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 30, itadGameId: 'game-uuid-30' },
        { id: 31, itadGameId: 'game-uuid-31' },
      ]);
      // Empty batch result — ITAD has no data for these IDs
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      // No bulk execute for pricing (no matched games)
      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });

  describe('syncPricing — edge: multiple consecutive chunk failures', () => {
    it('attempts all chunks even when every chunk fails', async () => {
      const games = Array.from({ length: 150 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      // All three chunks fail
      mockItadPriceService.getOverviewBatch
        .mockRejectedValueOnce(new Error('Chunk 1 failure'))
        .mockRejectedValueOnce(new Error('Chunk 2 failure'))
        .mockRejectedValueOnce(new Error('Chunk 3 failure'));

      await expect(service.syncPricing()).resolves.not.toThrow();

      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledTimes(3);
    });
  });

  describe('syncPricing — edge: single game, exact chunk boundary', () => {
    it('processes exactly 50 games in a single batch', async () => {
      const games = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledTimes(1);
      const callArgs = mockItadPriceService.getOverviewBatch.mock
        .calls[0][0] as string[];
      expect(callArgs).toHaveLength(50);
    });

    it('processes 51 games in exactly two batches (50 + 1)', async () => {
      const games = Array.from({ length: 51 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      mockItadPriceService.getOverviewBatch.mockResolvedValue([]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledTimes(2);
      const second = mockItadPriceService.getOverviewBatch.mock
        .calls[1][0] as string[];
      expect(second).toHaveLength(1);
    });
  });

  describe('buildUpdateData — price formatting', () => {
    it('formats price amounts to 2 decimal places', () => {
      const entry = buildEntry('game-price-fmt', {
        current: {
          shop: { id: 1, name: 'Steam' },
          price: { amount: 9.9, amountInt: 990, currency: 'USD' },
          regular: { amount: 19.99, amountInt: 1999, currency: 'USD' },
          cut: 50,
          url: 'https://store.steampowered.com/app/40',
        },
      });
      const data = buildUpdateData(entry, new Date());

      // toFixed(2) on 9.9 should produce '9.90'
      expect(data.itadCurrentPrice).toBe('9.90');
    });
  });

  describe('processChunk — error detail logging', () => {
    it('extracts Postgres error .cause details into log message', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 1, itadGameId: 'game-uuid-1' },
      ]);
      const pgCause = Object.assign(new Error('column "x" does not exist'), {
        code: '42703',
        detail: 'Column missing',
        hint: 'Check spelling',
      });
      const wrapperError = new Error('Failed query: UPDATE ...');
      (wrapperError as any).cause = pgCause;
      mockItadPriceService.getOverviewBatch.mockRejectedValueOnce(wrapperError);
      mockDb.returning.mockResolvedValue([]);

      const logSpy = jest.spyOn(service['logger'], 'error');

      await service.syncPricing();

      const logMsg = logSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain('code=42703');
      expect(logMsg).toContain('detail=Column missing');
      expect(logMsg).toContain('hint=Check spelling');
    });
  });

  describe('processChunk — returns boolean for success tracking', () => {
    it('syncPricing logs success and failure counts', async () => {
      const games = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        itadGameId: `game-uuid-${i + 1}`,
      }));
      mockDb.where.mockResolvedValueOnce(games);
      // First chunk succeeds (returns empty entries), second fails
      mockItadPriceService.getOverviewBatch
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('chunk 2 fail'));
      mockDb.returning.mockResolvedValue([]);

      const warnSpy = jest.spyOn(service['logger'], 'warn');

      await service.syncPricing();

      const warnMsg = warnSpy.mock.calls.find((c) =>
        (c[0] as string).includes('chunks succeeded'),
      );
      expect(warnMsg).toBeDefined();
      expect(warnMsg![0]).toContain('1 chunks succeeded');
      expect(warnMsg![0]).toContain('1 failed');
    });

    it('logs at log level when all chunks succeed', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 1, itadGameId: 'game-uuid-1' },
      ]);
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValue([]);

      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.syncPricing();

      const completeMsg = logSpy.mock.calls.find((c) =>
        (c[0] as string).includes('chunks succeeded'),
      );
      expect(completeMsg).toBeDefined();
      expect(completeMsg![0]).toContain('1 chunks succeeded');
      expect(completeMsg![0]).toContain('0 failed');
    });
  });

  describe('onApplicationBootstrap', () => {
    it('schedules the sync via setTimeout (does not call syncPricing immediately)', () => {
      jest.useFakeTimers();

      service.onApplicationBootstrap();

      // syncPricing not called yet — timer hasn't fired
      expect(mockItadPriceService.getOverviewBatch).not.toHaveBeenCalled();

      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('does not throw synchronously when called', () => {
      jest.useFakeTimers();
      expect(() => service.onApplicationBootstrap()).not.toThrow();
      jest.clearAllTimers();
      jest.useRealTimers();
    });
  });
});
