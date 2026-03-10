/**
 * Adversarial tests for ItadService (ROK-773).
 * Covers lookupSteamAppIds edge cases, parseShopLookupResponse
 * boundary values, and getGameInfo error paths.
 */
import { Test } from '@nestjs/testing';
import { ItadService } from './itad.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';

jest.mock('./itad-http.util', () => ({
  itadFetch: jest.fn(),
  itadPost: jest.fn(),
}));

jest.mock('./itad-cache.util', () => ({
  getCachedLookup: jest.fn(),
  setCachedLookup: jest.fn(),
  getCachedSearch: jest.fn(),
  setCachedSearch: jest.fn(),
  getCachedInfo: jest.fn(),
  setCachedInfo: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { itadFetch, itadPost } = require('./itad-http.util') as {
  itadFetch: jest.Mock;
  itadPost: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cacheUtil = require('./itad-cache.util') as {
  getCachedLookup: jest.Mock;
  setCachedLookup: jest.Mock;
  getCachedSearch: jest.Mock;
  setCachedSearch: jest.Mock;
  getCachedInfo: jest.Mock;
  setCachedInfo: jest.Mock;
};

describe('ItadService — adversarial', () => {
  let service: ItadService;
  let mockSettings: { getItadApiKey: jest.Mock };

  beforeEach(async () => {
    const mockRedis = { get: jest.fn(), set: jest.fn() };
    mockSettings = { getItadApiKey: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ItadService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();

    service = module.get(ItadService);
    jest.clearAllMocks();
  });

  describe('lookupSteamAppIds — response parsing', () => {
    it('handles response with multiple app IDs', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('key');
      itadPost.mockResolvedValue({
        'app/100': 'uuid-a',
        'app/200': 'uuid-b',
        'app/300': 'uuid-c',
      });

      const result = await service.lookupSteamAppIds([
        { id: 'uuid-a', slug: 'game-a' },
        { id: 'uuid-b', slug: 'game-b' },
        { id: 'uuid-c', slug: 'game-c' },
      ]);

      expect(result.get('uuid-a')).toBe(100);
      expect(result.get('uuid-b')).toBe(200);
      expect(result.get('uuid-c')).toBe(300);
      expect(result.size).toBe(3);
    });

    it('ignores keys that do not start with "app/"', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('key');
      itadPost.mockResolvedValue({
        'app/100': 'uuid-a',
        'sub/999': 'uuid-b', // subscription, not an app
        'bundle/50': 'uuid-c', // bundle
      });

      const result = await service.lookupSteamAppIds([
        { id: 'uuid-a', slug: 'game-a' },
        { id: 'uuid-b', slug: 'game-b' },
        { id: 'uuid-c', slug: 'game-c' },
      ]);

      expect(result.size).toBe(1);
      expect(result.get('uuid-a')).toBe(100);
    });

    it('ignores entries where value is null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('key');
      itadPost.mockResolvedValue({
        'app/100': 'uuid-a',
        'app/200': null, // no ITAD match
      });

      const result = await service.lookupSteamAppIds([
        { id: 'uuid-a', slug: 'game-a' },
        { id: 'uuid-b', slug: 'game-b' },
      ]);

      expect(result.size).toBe(1);
      expect(result.get('uuid-a')).toBe(100);
    });

    it('ignores entries with non-numeric app IDs', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('key');
      itadPost.mockResolvedValue({
        'app/abc': 'uuid-bad',
        'app/100': 'uuid-good',
      });

      const result = await service.lookupSteamAppIds([
        { id: 'uuid-bad', slug: 'bad' },
        { id: 'uuid-good', slug: 'good' },
      ]);

      expect(result.size).toBe(1);
      expect(result.get('uuid-good')).toBe(100);
    });

    it('handles empty response object', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('key');
      itadPost.mockResolvedValue({});

      const result = await service.lookupSteamAppIds([
        { id: 'uuid-1', slug: 'test' },
      ]);

      expect(result.size).toBe(0);
    });
  });

  describe('lookupBySteamAppId — edge cases', () => {
    it('returns null when API responds with found=true but no game', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('key');
      cacheUtil.getCachedLookup.mockResolvedValue(null);
      itadFetch.mockResolvedValue({ found: true });

      const result = await service.lookupBySteamAppId(999);

      // found=true but game is undefined -> !result.game is truthy
      expect(result).toBeNull();
    });
  });

  describe('searchGames — edge cases', () => {
    it('handles empty string search query', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('key');
      cacheUtil.getCachedSearch.mockResolvedValue(null);
      itadFetch.mockResolvedValue([]);

      const result = await service.searchGames('');

      expect(result).toEqual([]);
      expect(itadFetch).toHaveBeenCalledWith(
        '/games/search/v1',
        expect.objectContaining({ title: '' }),
      );
    });

    it('passes custom limit parameter', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('key');
      cacheUtil.getCachedSearch.mockResolvedValue(null);
      itadFetch.mockResolvedValue([]);

      await service.searchGames('test', 5);

      expect(itadFetch).toHaveBeenCalledWith(
        '/games/search/v1',
        expect.objectContaining({ results: '5' }),
      );
    });
  });

  describe('getGameInfo — edge cases', () => {
    it('does not cache when itadFetch returns null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('key');
      cacheUtil.getCachedInfo.mockResolvedValue(null);
      itadFetch.mockResolvedValue(null);

      const result = await service.getGameInfo('missing-uuid');

      expect(result).toBeNull();
      expect(cacheUtil.setCachedInfo).not.toHaveBeenCalled();
    });
  });
});
