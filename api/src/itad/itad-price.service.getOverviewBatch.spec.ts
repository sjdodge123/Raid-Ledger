/**
 * Adversarial unit tests for ItadPriceService.getOverviewBatch (ROK-800).
 * Verifies batch cache logic, API call patterns, and graceful degradation.
 */
import { Test } from '@nestjs/testing';
import { ItadPriceService } from './itad-price.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import type {
  ItadOverviewGameEntry,
  ItadOverviewResponse,
} from './itad-price.types';

jest.mock('./itad-http.util', () => ({
  itadPost: jest.fn(),
}));

jest.mock('./itad-cache.util', () => ({
  getCachedPrice: jest.fn(),
  setCachedPrice: jest.fn(),
  getCachedLookup: jest.fn(),
  setCachedLookup: jest.fn(),
  getCachedSearch: jest.fn(),
  setCachedSearch: jest.fn(),
  getCachedInfo: jest.fn(),
  setCachedInfo: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { itadPost } = require('./itad-http.util') as { itadPost: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cacheUtil = require('./itad-cache.util') as {
  getCachedPrice: jest.Mock;
  setCachedPrice: jest.Mock;
};

const ENTRY_A: ItadOverviewGameEntry = {
  id: 'itad-a',
  current: {
    shop: { id: 61, name: 'Steam' },
    price: { amount: 19.99, amountInt: 1999, currency: 'USD' },
    regular: { amount: 39.99, amountInt: 3999, currency: 'USD' },
    cut: 50,
    url: 'https://steam.com/app/111',
  },
  lowest: null,
  bundled: 0,
  urls: { game: 'https://isthereanydeal.com/game/a/' },
};

const ENTRY_B: ItadOverviewGameEntry = {
  id: 'itad-b',
  current: {
    shop: { id: 35, name: 'GOG' },
    price: { amount: 9.99, amountInt: 999, currency: 'USD' },
    regular: { amount: 19.99, amountInt: 1999, currency: 'USD' },
    cut: 50,
    url: 'https://gog.com/game/222',
  },
  lowest: null,
  bundled: 0,
  urls: { game: 'https://isthereanydeal.com/game/b/' },
};

const FAKE_BATCH_RESPONSE: ItadOverviewResponse = {
  prices: [ENTRY_A, ENTRY_B],
  bundles: [],
};

describe('ItadPriceService.getOverviewBatch', () => {
  let service: ItadPriceService;
  let mockRedis: Record<string, jest.Mock>;
  let mockSettings: { getItadApiKey: jest.Mock };

  beforeEach(async () => {
    mockRedis = { get: jest.fn(), set: jest.fn() };
    mockSettings = { getItadApiKey: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ItadPriceService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();

    service = module.get(ItadPriceService);
    jest.clearAllMocks();
  });

  describe('graceful degradation', () => {
    it('returns empty array when itadGameIds is empty', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');

      const result = await service.getOverviewBatch([]);

      expect(result).toEqual([]);
      expect(itadPost).not.toHaveBeenCalled();
    });

    it('returns empty array when API key is not configured', async () => {
      mockSettings.getItadApiKey.mockResolvedValue(null);

      const result = await service.getOverviewBatch(['itad-a', 'itad-b']);

      expect(result).toEqual([]);
      expect(itadPost).not.toHaveBeenCalled();
    });

    it('returns empty array when itadPost returns null for all missing IDs', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(null);

      const result = await service.getOverviewBatch(['itad-a']);

      expect(result).toEqual([]);
    });

    it('returns empty array when itadPost returns empty prices', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue({ prices: [], bundles: [] });

      const result = await service.getOverviewBatch(['itad-a']);

      expect(result).toEqual([]);
    });
  });

  describe('full cache hit — no API call made', () => {
    it('returns all cached entries without calling itadPost', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice
        .mockResolvedValueOnce(ENTRY_A)
        .mockResolvedValueOnce(ENTRY_B);

      const result = await service.getOverviewBatch(['itad-a', 'itad-b']);

      expect(result).toHaveLength(2);
      expect(itadPost).not.toHaveBeenCalled();
    });

    it('returns cached entry with correct ID', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice.mockResolvedValueOnce(ENTRY_A);

      const result = await service.getOverviewBatch(['itad-a']);

      expect(result[0].id).toBe('itad-a');
    });
  });

  describe('full cache miss — fetches from ITAD', () => {
    it('calls itadPost with all missing IDs when none are cached', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('my-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(FAKE_BATCH_RESPONSE);

      await service.getOverviewBatch(['itad-a', 'itad-b']);

      expect(itadPost).toHaveBeenCalledWith(
        '/games/overview/v2',
        { key: 'my-api-key' },
        expect.arrayContaining(['itad-a', 'itad-b']),
      );
    });

    it('returns fetched entries from itadPost', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(FAKE_BATCH_RESPONSE);

      const result = await service.getOverviewBatch(['itad-a', 'itad-b']);

      expect(result).toHaveLength(2);
    });

    it('caches each fetched entry individually', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(FAKE_BATCH_RESPONSE);

      await service.getOverviewBatch(['itad-a', 'itad-b']);

      expect(cacheUtil.setCachedPrice).toHaveBeenCalledWith(
        mockRedis,
        'itad-a',
        ENTRY_A,
      );
      expect(cacheUtil.setCachedPrice).toHaveBeenCalledWith(
        mockRedis,
        'itad-b',
        ENTRY_B,
      );
    });
  });

  describe('partial cache hit — only fetches misses', () => {
    it('returns combined cached and fetched entries', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      // itad-a is cached, itad-b is a miss
      cacheUtil.getCachedPrice
        .mockResolvedValueOnce(ENTRY_A)
        .mockResolvedValueOnce(null);
      itadPost.mockResolvedValue({ prices: [ENTRY_B], bundles: [] });

      const result = await service.getOverviewBatch(['itad-a', 'itad-b']);

      expect(result).toHaveLength(2);
      const ids = result.map((e) => e.id);
      expect(ids).toContain('itad-a');
      expect(ids).toContain('itad-b');
    });

    it('only passes cache-miss IDs to itadPost', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice
        .mockResolvedValueOnce(ENTRY_A) // itad-a cached
        .mockResolvedValueOnce(null); // itad-b not cached
      itadPost.mockResolvedValue({ prices: [ENTRY_B], bundles: [] });

      await service.getOverviewBatch(['itad-a', 'itad-b']);

      expect(itadPost).toHaveBeenCalledWith(
        '/games/overview/v2',
        expect.anything(),
        ['itad-b'],
      );
    });

    it('does not re-cache already cached entries', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice
        .mockResolvedValueOnce(ENTRY_A)
        .mockResolvedValueOnce(null);
      itadPost.mockResolvedValue({ prices: [ENTRY_B], bundles: [] });

      await service.getOverviewBatch(['itad-a', 'itad-b']);

      // Only the newly fetched entry (itad-b) should be cached
      expect(cacheUtil.setCachedPrice).toHaveBeenCalledTimes(1);
      expect(cacheUtil.setCachedPrice).toHaveBeenCalledWith(
        mockRedis,
        'itad-b',
        ENTRY_B,
      );
    });
  });

  describe('single ID batch', () => {
    it('handles a single ID correctly when cached', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice.mockResolvedValueOnce(ENTRY_A);

      const result = await service.getOverviewBatch(['itad-a']);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('itad-a');
    });

    it('handles a single ID correctly when not cached', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedPrice.mockResolvedValueOnce(null);
      itadPost.mockResolvedValue({ prices: [ENTRY_A], bundles: [] });

      const result = await service.getOverviewBatch(['itad-a']);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('itad-a');
    });
  });
});
