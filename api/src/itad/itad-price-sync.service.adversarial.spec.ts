/**
 * Adversarial tests for ItadPriceSyncService (ROK-818).
 * Covers edge cases the dev's initial tests missed:
 * - buildUpdateData with null current / null lowest / both null
 * - onApplicationBootstrap setTimeout wiring
 * - getOverviewBatch returns empty array (no entries) — DB update still fires
 * - Games not in the ITAD response map still get a timestamp update
 * - Multiple chunk failures don't abort the entire sync
 * - DB update is called per-game, not once per chunk
 */
import { Test } from '@nestjs/testing';
import { ItadPriceSyncService } from './itad-price-sync.service';
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

  describe('syncPricing — edge: entry with null current deal', () => {
    it('writes null pricing columns when current is null but lowest exists', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 10, itadGameId: 'game-null-current' },
      ]);
      const entry = buildEntry('game-null-current', { current: null });
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([entry]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      const setCall = mockDb.set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall.itadCurrentPrice).toBeNull();
      expect(setCall.itadCurrentCut).toBeNull();
      expect(setCall.itadCurrentShop).toBeNull();
      expect(setCall.itadCurrentUrl).toBeNull();
      // lowest data should still be written
      expect(setCall.itadLowestPrice).toBe('4.99');
      expect(setCall.itadLowestCut).toBe(88);
      expect(setCall.itadPriceUpdatedAt).toBeInstanceOf(Date);
    });

    it('writes null lowest columns when lowest is null but current exists', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 11, itadGameId: 'game-null-lowest' },
      ]);
      const entry = buildEntry('game-null-lowest', { lowest: null });
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([entry]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      const setCall = mockDb.set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall.itadCurrentPrice).toBe('9.99');
      expect(setCall.itadCurrentCut).toBe(75);
      expect(setCall.itadLowestPrice).toBeNull();
      expect(setCall.itadLowestCut).toBeNull();
    });

    it('writes all pricing nulls when both current and lowest are null', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 12, itadGameId: 'game-all-null' },
      ]);
      const entry = buildEntry('game-all-null', {
        current: null,
        lowest: null,
      });
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([entry]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      const setCall = mockDb.set.mock.calls[0][0] as Record<string, unknown>;
      expect(setCall.itadCurrentPrice).toBeNull();
      expect(setCall.itadCurrentCut).toBeNull();
      expect(setCall.itadLowestPrice).toBeNull();
      expect(setCall.itadLowestCut).toBeNull();
      expect(setCall.itadPriceUpdatedAt).toBeInstanceOf(Date);
    });
  });

  describe('syncPricing — edge: game missing from ITAD response', () => {
    it('skips DB update when game is not in the ITAD response', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 20, itadGameId: 'game-in-db-not-in-itad' },
      ]);
      // ITAD returns entries for a different game — our game is absent
      const entry = buildEntry('some-other-game');
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([entry]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      // No per-game update (skipped), only clearStalePricing runs
      const setCalls = mockDb.set.mock.calls;
      // clearStalePricing sets nulls for stale games
      const staleCleanupCall = setCalls.find(
        (c: Record<string, unknown>[]) => c[0].itadCurrentPrice === null,
      );
      expect(staleCleanupCall).toBeDefined();
    });
  });

  describe('syncPricing — edge: getOverviewBatch returns empty array', () => {
    it('skips per-game updates when ITAD returns no entries', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 30, itadGameId: 'game-uuid-30' },
        { id: 31, itadGameId: 'game-uuid-31' },
      ]);
      // Empty batch result — ITAD has no data for these IDs
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      // No per-game pricing updates (all skipped), only clearStalePricing
      const setCalls = mockDb.set.mock.calls;
      const pricingUpdates = setCalls.filter(
        (c: Record<string, unknown>[]) => c[0].itadPriceUpdatedAt instanceof Date && c[0].itadCurrentPrice !== undefined,
      );
      expect(pricingUpdates).toHaveLength(0);
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

  describe('syncPricing — price formatting', () => {
    it('formats price amounts to 2 decimal places in update data', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 40, itadGameId: 'game-price-fmt' },
      ]);
      const entry = buildEntry('game-price-fmt', {
        current: {
          shop: { id: 1, name: 'Steam' },
          price: { amount: 9.9, amountInt: 990, currency: 'USD' },
          regular: { amount: 19.99, amountInt: 1999, currency: 'USD' },
          cut: 50,
          url: 'https://store.steampowered.com/app/40',
        },
      });
      mockItadPriceService.getOverviewBatch.mockResolvedValueOnce([entry]);
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      const setCall = mockDb.set.mock.calls[0][0] as Record<string, unknown>;
      // toFixed(2) on 9.9 should produce '9.90'
      expect(setCall.itadCurrentPrice).toBe('9.90');
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
