/**
 * Unit tests for ItadPriceService (ROK-419).
 * Verifies caching behavior, graceful degradation, and API call patterns.
 */
import { Test } from '@nestjs/testing';
import { ItadPriceService } from './itad-price.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import type { ItadOverviewEntry } from './itad-price.types';

// Mock the HTTP util — all ITAD calls go through itadPost
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

const FAKE_OVERVIEW: ItadOverviewEntry = {
  prices: [
    {
      shop: { id: 61, name: 'Steam' },
      price: { amount: 29.99, amountInt: 2999, currency: 'USD' },
      regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
      cut: 50,
      url: 'https://store.steampowered.com/app/12345',
    },
  ],
  lowest: {
    price: { amount: 14.99, amountInt: 1499, currency: 'USD' },
    shop: { id: 61, name: 'Steam' },
    recorded: '2024-11-25T00:00:00Z',
  },
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

    it('returns null when ITAD POST returns null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(null);

      const result = await service.getOverview('uuid-game-123');

      expect(result).toBeNull();
    });

    it('returns null when game ID is not found in ITAD response', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue({ 'different-game-uuid': FAKE_OVERVIEW });

      const result = await service.getOverview('uuid-game-123');

      expect(result).toBeNull();
    });
  });

  describe('getOverview — cache behavior', () => {
    it('returns cached entry on cache hit without calling ITAD', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(FAKE_OVERVIEW);

      const result = await service.getOverview('uuid-game-123');

      expect(result).toEqual(FAKE_OVERVIEW);
      expect(itadPost).not.toHaveBeenCalled();
    });

    it('calls ITAD API and caches result on cache miss', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue({ 'uuid-game-123': FAKE_OVERVIEW });

      const result = await service.getOverview('uuid-game-123');

      expect(result).toEqual(FAKE_OVERVIEW);
      expect(cacheUtil.setCachedPrice).toHaveBeenCalledWith(
        mockRedis,
        'uuid-game-123',
        FAKE_OVERVIEW,
      );
    });

    it('does not cache result when game not found in response', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue({});

      await service.getOverview('uuid-game-123');

      expect(cacheUtil.setCachedPrice).not.toHaveBeenCalled();
    });

    it('does not cache result when itadPost returns null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue(null);

      await service.getOverview('uuid-game-123');

      expect(cacheUtil.setCachedPrice).not.toHaveBeenCalled();
    });
  });

  describe('getOverview — ITAD API call shape', () => {
    it('posts to /games/overview/v2 with API key and game ID array', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('my-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue({ 'uuid-game-abc': FAKE_OVERVIEW });

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
      itadPost.mockResolvedValue({ 'specific-uuid': FAKE_OVERVIEW });

      await service.getOverview('specific-uuid');

      expect(cacheUtil.getCachedPrice).toHaveBeenCalledWith(
        mockRedis,
        'specific-uuid',
      );
    });
  });

  describe('getOverview — response data integrity', () => {
    it('returns the overview entry with prices and historical low', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue({ 'uuid-game-123': FAKE_OVERVIEW });

      const result = await service.getOverview('uuid-game-123');

      expect(result).toMatchObject({
        prices: expect.arrayContaining([
          expect.objectContaining({
            shop: expect.objectContaining({ name: expect.any(String) }),
            price: expect.objectContaining({ amount: expect.any(Number) }),
          }),
        ]),
        lowest: expect.objectContaining({
          price: expect.objectContaining({ amount: expect.any(Number) }),
          recorded: expect.any(String),
        }),
      });
    });

    it('handles overview entry with null lowest (no historical low)', async () => {
      const overviewNoLow: ItadOverviewEntry = { ...FAKE_OVERVIEW, lowest: null };
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue({ 'uuid-game-123': overviewNoLow });

      const result = await service.getOverview('uuid-game-123');

      expect(result).not.toBeNull();
      expect(result!.lowest).toBeNull();
    });

    it('handles overview entry with empty prices array', async () => {
      const overviewNoPrices: ItadOverviewEntry = { prices: [], lowest: null };
      mockSettings.getItadApiKey.mockResolvedValue('test-api-key');
      cacheUtil.getCachedPrice.mockResolvedValue(null);
      itadPost.mockResolvedValue({ 'uuid-game-123': overviewNoPrices });

      const result = await service.getOverview('uuid-game-123');

      expect(result).not.toBeNull();
      expect(result!.prices).toHaveLength(0);
    });
  });
});
