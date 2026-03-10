import { Test } from '@nestjs/testing';
import { ItadService } from './itad.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import type { ItadGame, ItadGameInfo } from './itad.constants';

// Mock the HTTP util — all ITAD calls go through itadFetch/itadPost
jest.mock('./itad-http.util', () => ({
  itadFetch: jest.fn(),
  itadPost: jest.fn(),
}));

// Mock the cache util so we control cache hits/misses directly
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

const FAKE_ITAD_GAME: ItadGame = {
  id: 'uuid-123',
  slug: 'elden-ring',
  title: 'Elden Ring',
  type: 'game',
  mature: false,
};

const FAKE_GAME_INFO: ItadGameInfo = {
  id: 'uuid-123',
  slug: 'elden-ring',
  title: 'Elden Ring',
  type: 'game',
  mature: false,
  tags: ['rpg'],
  developers: ['FromSoftware'],
};

describe('ItadService', () => {
  let service: ItadService;
  let mockRedis: Record<string, jest.Mock>;
  let mockSettings: { getItadApiKey: jest.Mock };

  beforeEach(async () => {
    mockRedis = { get: jest.fn(), set: jest.fn() };
    mockSettings = { getItadApiKey: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        ItadService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();

    service = module.get(ItadService);

    // Reset all mocked modules between tests
    jest.clearAllMocks();
  });

  describe('lookupBySteamAppId', () => {
    it('returns null when API key is not configured', async () => {
      mockSettings.getItadApiKey.mockResolvedValue(null);

      const result = await service.lookupBySteamAppId(1245620);

      expect(result).toBeNull();
      expect(itadFetch).not.toHaveBeenCalled();
    });

    it('returns cached data on cache hit', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedLookup.mockResolvedValue(FAKE_ITAD_GAME);

      const result = await service.lookupBySteamAppId(1245620);

      expect(result).toEqual(FAKE_ITAD_GAME);
      expect(itadFetch).not.toHaveBeenCalled();
    });

    it('calls itadFetch and caches result on cache miss', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedLookup.mockResolvedValue(null);
      itadFetch.mockResolvedValue({
        found: true,
        game: FAKE_ITAD_GAME,
      });

      const result = await service.lookupBySteamAppId(1245620);

      expect(result).toEqual(FAKE_ITAD_GAME);
      expect(itadFetch).toHaveBeenCalledWith(
        '/games/lookup/v1',
        expect.objectContaining({
          key: 'test-key',
          appid: '1245620',
        }),
      );
      expect(cacheUtil.setCachedLookup).toHaveBeenCalledWith(
        mockRedis,
        1245620,
        FAKE_ITAD_GAME,
      );
    });

    it('returns null when ITAD responds with not found', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedLookup.mockResolvedValue(null);
      itadFetch.mockResolvedValue({ found: false });

      const result = await service.lookupBySteamAppId(999999);

      expect(result).toBeNull();
      expect(cacheUtil.setCachedLookup).not.toHaveBeenCalled();
    });

    it('returns null when itadFetch returns null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedLookup.mockResolvedValue(null);
      itadFetch.mockResolvedValue(null);

      const result = await service.lookupBySteamAppId(999999);

      expect(result).toBeNull();
    });
  });

  describe('searchGames', () => {
    it('returns empty array when API key is not configured', async () => {
      mockSettings.getItadApiKey.mockResolvedValue(null);

      const result = await service.searchGames('elden ring');

      expect(result).toEqual([]);
      expect(itadFetch).not.toHaveBeenCalled();
    });

    it('returns cached data on cache hit', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedSearch.mockResolvedValue([FAKE_ITAD_GAME]);

      const result = await service.searchGames('elden ring');

      expect(result).toEqual([FAKE_ITAD_GAME]);
      expect(itadFetch).not.toHaveBeenCalled();
    });

    it('calls itadFetch and caches results on cache miss', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedSearch.mockResolvedValue(null);
      itadFetch.mockResolvedValue([FAKE_ITAD_GAME]);

      const result = await service.searchGames('elden ring', 10);

      expect(result).toEqual([FAKE_ITAD_GAME]);
      expect(itadFetch).toHaveBeenCalledWith(
        '/games/search/v1',
        expect.objectContaining({
          key: 'test-key',
          title: 'elden ring',
          results: '10',
        }),
      );
      expect(cacheUtil.setCachedSearch).toHaveBeenCalledWith(
        mockRedis,
        'elden ring',
        10,
        [FAKE_ITAD_GAME],
      );
    });

    it('uses default limit of 20 when not specified', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedSearch.mockResolvedValue(null);
      itadFetch.mockResolvedValue([FAKE_ITAD_GAME]);

      await service.searchGames('elden ring');

      expect(itadFetch).toHaveBeenCalledWith(
        '/games/search/v1',
        expect.objectContaining({ results: '20' }),
      );
    });

    it('returns empty array and skips caching when ITAD returns null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedSearch.mockResolvedValue(null);
      itadFetch.mockResolvedValue(null);

      const result = await service.searchGames('nonexistent');

      expect(result).toEqual([]);
      expect(cacheUtil.setCachedSearch).not.toHaveBeenCalled();
    });

    it('skips caching when ITAD returns empty array', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedSearch.mockResolvedValue(null);
      itadFetch.mockResolvedValue([]);

      const result = await service.searchGames('nonexistent');

      expect(result).toEqual([]);
      expect(cacheUtil.setCachedSearch).not.toHaveBeenCalled();
    });
  });

  describe('getGameInfo', () => {
    it('returns null when API key is not configured', async () => {
      mockSettings.getItadApiKey.mockResolvedValue(null);

      const result = await service.getGameInfo('uuid-123');

      expect(result).toBeNull();
      expect(itadFetch).not.toHaveBeenCalled();
    });

    it('returns cached data on cache hit', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedInfo.mockResolvedValue(FAKE_GAME_INFO);

      const result = await service.getGameInfo('uuid-123');

      expect(result).toEqual(FAKE_GAME_INFO);
      expect(itadFetch).not.toHaveBeenCalled();
    });

    it('calls itadFetch and caches result on cache miss', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedInfo.mockResolvedValue(null);
      itadFetch.mockResolvedValue(FAKE_GAME_INFO);

      const result = await service.getGameInfo('uuid-123');

      expect(result).toEqual(FAKE_GAME_INFO);
      expect(itadFetch).toHaveBeenCalledWith(
        '/games/info/v2',
        expect.objectContaining({
          key: 'test-key',
          id: 'uuid-123',
        }),
      );
      expect(cacheUtil.setCachedInfo).toHaveBeenCalledWith(
        mockRedis,
        'uuid-123',
        FAKE_GAME_INFO,
      );
    });

    it('returns null when ITAD returns null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      cacheUtil.getCachedInfo.mockResolvedValue(null);
      itadFetch.mockResolvedValue(null);

      const result = await service.getGameInfo('uuid-missing');

      expect(result).toBeNull();
      expect(cacheUtil.setCachedInfo).not.toHaveBeenCalled();
    });
  });

  describe('lookupSteamAppIds', () => {
    it('returns empty map when API key is not configured', async () => {
      mockSettings.getItadApiKey.mockResolvedValue(null);

      const result = await service.lookupSteamAppIds([
        { id: 'uuid-1', slug: 'elden-ring' },
      ]);

      expect(result.size).toBe(0);
      expect(itadPost).not.toHaveBeenCalled();
    });

    it('returns empty map when given empty array', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');

      const result = await service.lookupSteamAppIds([]);

      expect(result.size).toBe(0);
      expect(itadPost).not.toHaveBeenCalled();
    });

    it('maps ITAD game IDs to Steam app IDs', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      itadPost.mockResolvedValue({
        'app/1245620': 'uuid-1',
      });

      const result = await service.lookupSteamAppIds([
        { id: 'uuid-1', slug: 'elden-ring' },
      ]);

      expect(result.get('uuid-1')).toBe(1245620);
      expect(itadPost).toHaveBeenCalledWith(
        '/lookup/shop/61/id/v1',
        expect.objectContaining({ key: 'test-key', shops: '61' }),
        ['uuid-1'],
      );
    });

    it('skips entries with null values from ITAD', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      itadPost.mockResolvedValue({
        'app/1245620': 'uuid-1',
        null: 'uuid-2',
      });

      const result = await service.lookupSteamAppIds([
        { id: 'uuid-1', slug: 'elden-ring' },
        { id: 'uuid-2', slug: 'no-steam' },
      ]);

      expect(result.get('uuid-1')).toBe(1245620);
      expect(result.has('uuid-2')).toBe(false);
    });

    it('returns empty map when itadPost returns null', async () => {
      mockSettings.getItadApiKey.mockResolvedValue('test-key');
      itadPost.mockResolvedValue(null);

      const result = await service.lookupSteamAppIds([
        { id: 'uuid-1', slug: 'test' },
      ]);

      expect(result.size).toBe(0);
    });
  });
});
