/**
 * Unit tests for SteamWishlistService (ROK-418).
 */
import { Test } from '@nestjs/testing';
import { SteamWishlistService } from './steam-wishlist.service';
import { IgdbService } from '../igdb/igdb.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import * as steamHttp from './steam-http.util';

jest.mock('./steam-http.util');

describe('SteamWishlistService', () => {
  let service: SteamWishlistService;
  let mockDb: MockDb;
  let mockSettingsService: { getSteamApiKey: jest.Mock };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockSettingsService = {
      getSteamApiKey: jest.fn().mockResolvedValue('test-api-key'),
    };

    const module = await Test.createTestingModule({
      providers: [
        SteamWishlistService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: IgdbService,
          useValue: { queryIgdb: jest.fn(), upsertGamesFromApi: jest.fn() },
        },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    service = module.get(SteamWishlistService);
  });

  describe('syncWishlist', () => {
    beforeEach(() => {
      mockDb.query = {
        users: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            steamId: '76561198000000001',
          }),
        },
      } as unknown as jest.Mock;

      (steamHttp.getPlayerSummary as jest.Mock).mockResolvedValue({
        communityvisibilitystate: 3,
      });
    });

    it('returns zero result when wishlist is empty', async () => {
      (steamHttp.getWishlist as jest.Mock).mockResolvedValue([]);

      // fetchExistingWishlistIds terminates at .where — no existing entries
      mockDb.where.mockResolvedValueOnce([]);

      const result = await service.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 0,
        matched: 0,
        newInterests: 0,
        removed: 0,
      });
    });

    it('inserts matched wishlist games as interests', async () => {
      (steamHttp.getWishlist as jest.Mock).mockResolvedValue([
        { appid: 100, date_added: 1000 },
        { appid: 200, date_added: 2000 },
      ]);

      // findMatchingGames
      mockDb.where
        .mockResolvedValueOnce([
          { id: 1, steamAppId: 100 },
          { id: 2, steamAppId: 200 },
        ])
        // fetchExistingWishlistIds
        .mockResolvedValueOnce([]);

      // insert
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);

      const result = await service.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 2,
        matched: 2,
        newInterests: 2,
        removed: 0,
      });
    });

    it('removes games no longer on wishlist', async () => {
      (steamHttp.getWishlist as jest.Mock).mockResolvedValue([]);

      // fetchExistingWishlistIds terminates at .where
      mockDb.where.mockResolvedValueOnce([{ gameId: 5 }]);

      // removeWishlistEntries: delete().where().returning()
      mockDb.returning.mockResolvedValueOnce([{ id: 99 }]);

      const result = await service.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 0,
        matched: 0,
        newInterests: 0,
        removed: 1,
      });
    });

    it('throws when user has no Steam account', async () => {
      mockDb.query = {
        users: {
          findFirst: jest.fn().mockResolvedValue({ id: 1, steamId: null }),
        },
      } as unknown as jest.Mock;

      await expect(service.syncWishlist(1)).rejects.toThrow(
        'User has no linked Steam account',
      );
    });

    it('returns zero result when profile is private', async () => {
      (steamHttp.getPlayerSummary as jest.Mock).mockResolvedValue({
        communityvisibilitystate: 1,
      });

      const result = await service.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 0,
        matched: 0,
        newInterests: 0,
        removed: 0,
      });
    });

    it('returns zero result for friends-only profile (state 2)', async () => {
      (steamHttp.getPlayerSummary as jest.Mock).mockResolvedValue({
        communityvisibilitystate: 2,
      });

      const result = await service.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 0,
        matched: 0,
        newInterests: 0,
        removed: 0,
      });
    });

    it('throws when Steam API key is not configured', async () => {
      mockSettingsService.getSteamApiKey.mockResolvedValue(null);

      await expect(service.syncWishlist(1)).rejects.toThrow(
        'Steam API key is not configured',
      );
    });

    it('throws when user does not exist', async () => {
      mockDb.query = {
        users: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as unknown as jest.Mock;

      await expect(service.syncWishlist(1)).rejects.toThrow(
        'User has no linked Steam account',
      );
    });

    it('handles empty wishlist with existing entries (removes all)', async () => {
      (steamHttp.getWishlist as jest.Mock).mockResolvedValue([]);

      // fetchExistingWishlistIds returns multiple existing entries
      mockDb.where.mockResolvedValueOnce([{ gameId: 1 }, { gameId: 2 }, { gameId: 3 }]);

      // removeWishlistEntries: delete().where().returning()
      mockDb.returning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);

      const result = await service.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 0,
        matched: 0,
        newInterests: 0,
        removed: 3,
      });
    });

    it('proceeds when getPlayerSummary returns null', async () => {
      (steamHttp.getPlayerSummary as jest.Mock).mockResolvedValue(null);
      (steamHttp.getWishlist as jest.Mock).mockResolvedValue([]);

      mockDb.where.mockResolvedValueOnce([]);

      const result = await service.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 0,
        matched: 0,
        newInterests: 0,
        removed: 0,
      });
    });

    it('skips insert when all wishlist games already tracked', async () => {
      (steamHttp.getWishlist as jest.Mock).mockResolvedValue([
        { appid: 100, date_added: 1000 },
      ]);

      // findMatchingGames
      mockDb.where
        .mockResolvedValueOnce([{ id: 1, steamAppId: 100 }])
        // fetchExistingWishlistIds — game 1 already exists
        .mockResolvedValueOnce([{ gameId: 1 }]);

      const result = await service.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 1,
        matched: 1,
        newInterests: 0,
        removed: 0,
      });
    });

    it('handles combined add and remove in re-sync', async () => {
      (steamHttp.getWishlist as jest.Mock).mockResolvedValue([
        { appid: 200, date_added: 1000 },
      ]);

      // findMatchingGames
      mockDb.where
        .mockResolvedValueOnce([{ id: 2, steamAppId: 200 }])
        // fetchExistingWishlistIds — game 1 was previously tracked
        .mockResolvedValueOnce([{ gameId: 1 }]);

      // insertWishlistEntries: insert game 2
      mockDb.returning
        .mockResolvedValueOnce([{ id: 20 }])
        // removeWishlistEntries: remove game 1
        .mockResolvedValueOnce([{ id: 99 }]);

      const result = await service.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 1,
        matched: 1,
        newInterests: 1,
        removed: 1,
      });
    });
  });

  describe('syncWishlist — no IGDB service', () => {
    let serviceNoIgdb: SteamWishlistService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          SteamWishlistService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          { provide: SettingsService, useValue: mockSettingsService },
        ],
      }).compile();

      serviceNoIgdb = module.get(SteamWishlistService);

      mockDb.query = {
        users: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            steamId: '76561198000000001',
          }),
        },
      } as unknown as jest.Mock;

      (steamHttp.getPlayerSummary as jest.Mock).mockResolvedValue({
        communityvisibilitystate: 3,
      });
    });

    it('works without IGDB service (no backfill)', async () => {
      (steamHttp.getWishlist as jest.Mock).mockResolvedValue([
        { appid: 100, date_added: 1000 },
      ]);

      // findMatchingGames — no match (game not in DB)
      mockDb.where
        .mockResolvedValueOnce([])
        // fetchExistingWishlistIds
        .mockResolvedValueOnce([]);

      const result = await serviceNoIgdb.syncWishlist(1);

      expect(result).toMatchObject({
        totalWishlisted: 1,
        matched: 0,
        newInterests: 0,
        removed: 0,
      });
    });
  });
});
