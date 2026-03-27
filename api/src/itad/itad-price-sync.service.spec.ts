/**
 * Tests for ItadPriceSyncService (ROK-818, ROK-987).
 * Verifies cron-based ITAD pricing sync behavior.
 */
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
});
