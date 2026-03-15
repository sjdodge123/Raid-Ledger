/**
 * Tests for ItadPriceSyncService (ROK-818).
 * Verifies cron-based ITAD pricing sync behavior.
 */
import { Test } from '@nestjs/testing';
import { ItadPriceSyncService } from './itad-price-sync.service';
import { ItadPriceService } from './itad-price.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type { ItadOverviewGameEntry } from './itad-price.types';

describe('ItadPriceSyncService', () => {
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
      // update query returning
      mockDb.returning.mockResolvedValue([]);

      await service.syncPricing();

      expect(mockItadPriceService.getOverviewBatch).toHaveBeenCalledWith([
        'game-uuid-1',
        'game-uuid-2',
      ]);
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
});
