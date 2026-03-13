/**
 * Unit tests for ItadPriceService (ROK-419).
 * Verifies caching behavior, graceful degradation, and API call patterns.
 */
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ItadPriceService } from './itad-price.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import type {
  ItadOverviewGameEntry,
  ItadOverviewResponse,
} from './itad-price.types';

// Mock the HTTP util — overview uses itadPost (POST)
jest.mock('./itad-http.util', () => ({
  itadPost: jest.fn(),
}));

// Mock the cache util so we control cache hits/misses directly
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

const FAKE_ENTRY: ItadOverviewGameEntry = {
  id: 'uuid-game-123',
  current: {
    shop: { id: 61, name: 'Steam' },
    price: { amount: 29.99, amountInt: 2999, currency: 'USD' },
    regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
    cut: 50,
    url: 'https://store.steampowered.com/app/12345',
  },
  lowest: {
    shop: { id: 61, name: 'Steam' },
    price: { amount: 14.99, amountInt: 1499, currency: 'USD' },
    regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
    cut: 75,
    timestamp: '2024-11-25T00:00:00Z',
  },
  bundled: 0,
  urls: { game: 'https://isthereanydeal.com/game/test/' },
};

const FAKE_RESPONSE: ItadOverviewResponse = {
  prices: [FAKE_ENTRY],
  bundles: [],
};

describe('ItadPriceService', () => {
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

  describe('getOverview — graceful degradation', () => {
    it('returns null when API key is not configured', async () => {
      mockSettings.getItadApiKey.mockResolvedValue(null);

      const result = await service.getOverview('uuid-game-123');

      expect(result).toBeNull();
      expect(itadPost).not.toHaveBeenCalled();
    });

    it('Regression: ROK-812 — logs a warning when API key is not configured', async () => {
      mockSettings.getItadApiKey.mockResolvedValue(null);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await service.getOverview('uuid-game-123');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ITAD API key not configured'),
      );
      warnSpy.mockRestore();
    });

    it('returns null when itadPost returns null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(null);

      const result = await service.getOverview('uuid-game-123');

      expect(result).toBeNull();
    });

    it('returns null when response has empty prices array', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue({ prices: [], bundles: [] });

      const result = await service.getOverview('uuid-game-123');

      expect(result).toBeNull();
    });

    it('returns null when no entry matches the game ID', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      const otherEntry = { ...FAKE_ENTRY, id: 'other-game' };
      itadPost.mockResolvedValue({ prices: [otherEntry], bundles: [] });

      const result = await service.getOverview('uuid-game-123');

      expect(result).toBeNull();
    });
  });

  describe('getOverview — cache behavior', () => {
    it('returns cached entry on cache hit without calling ITAD', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(FAKE_ENTRY);

      const result = await service.getOverview('uuid-game-123');

      expect(result).toEqual(FAKE_ENTRY);
      expect(itadPost).not.toHaveBeenCalled();
    });

    it('calls ITAD API and caches entry on cache miss', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(FAKE_RESPONSE);

      const result = await service.getOverview('uuid-game-123');

      expect(result).toEqual(FAKE_ENTRY);
      expect(cacheUtil.setCachedPrice).toHaveBeenCalledWith(
        mockRedis,
        'uuid-game-123',
        FAKE_ENTRY,
      );
    });

    it('does not cache when itadPost returns null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(null);

      await service.getOverview('uuid-game-123');

      expect(cacheUtil.setCachedPrice).not.toHaveBeenCalled();
    });

    it('does not cache when no entry matches game ID', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      const otherEntry = { ...FAKE_ENTRY, id: 'other-game' };
      itadPost.mockResolvedValue({ prices: [otherEntry], bundles: [] });

      await service.getOverview('uuid-game-123');

      expect(cacheUtil.setCachedPrice).not.toHaveBeenCalled();
    });
  });

  describe('getOverview — API call shape', () => {
    it('calls itadPost with correct path, key, and game ID array', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('my-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(FAKE_RESPONSE);

      await service.getOverview('uuid-game-abc');

      expect(itadPost).toHaveBeenCalledWith(
        '/games/overview/v2',
        { key: 'my-api-key' },
        ['uuid-game-abc'],
      );
    });

    it('uses the game ID as the cache key', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(FAKE_RESPONSE);

      await service.getOverview('specific-uuid');

      expect(cacheUtil.getCachedPrice).toHaveBeenCalledWith(
        mockRedis,
        'specific-uuid',
      );
    });
  });

  describe('getOverview — response data', () => {
    it('extracts the matching entry from the prices array', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(FAKE_RESPONSE);

      const result = await service.getOverview('uuid-game-123');

      expect(result).toEqual(FAKE_ENTRY);
      expect(result!.id).toBe('uuid-game-123');
      expect(result!.current!.shop.name).toBe('Steam');
    });
  });
});
