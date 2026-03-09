import { Test } from '@nestjs/testing';
import { SteamService } from './steam.service';
import { IgdbService } from '../igdb/igdb.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import * as steamHttp from './steam-http.util';

jest.mock('./steam-http.util');

describe('SteamService', () => {
  let service: SteamService;
  let mockDb: MockDb;
  let mockIgdbService: { queryIgdb: jest.Mock; upsertGamesFromApi: jest.Mock };
  let mockSettingsService: { getSteamApiKey: jest.Mock };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockIgdbService = {
      queryIgdb: jest.fn().mockResolvedValue([]),
      upsertGamesFromApi: jest.fn().mockResolvedValue([]),
    };
    mockSettingsService = {
      getSteamApiKey: jest.fn().mockResolvedValue('test-api-key'),
    };

    const module = await Test.createTestingModule({
      providers: [
        SteamService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: IgdbService, useValue: mockIgdbService },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    service = module.get(SteamService);
  });

  describe('syncLibrary — backfill flow', () => {
    beforeEach(() => {
      // User has steamId
      mockDb.query = {
        users: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            steamId: '76561198000000001',
          }),
        },
      } as unknown as jest.Mock;

      // Steam profile is public
      (steamHttp.getPlayerSummary as jest.Mock).mockResolvedValue({
        communityvisibilitystate: 3,
      });
    });

    it('calls IGDB backfill when unmatched Steam games exist', async () => {
      const ownedGames = [
        { appid: 100, playtime_forever: 500 },
        { appid: 200, playtime_forever: 300 },
        { appid: 300, playtime_forever: 100 },
      ];
      (steamHttp.getOwnedGames as jest.Mock).mockResolvedValue(ownedGames);

      // First findMatchingGames: only appid 100 matched
      // After backfill: appid 200 also matched
      mockDb.where
        .mockResolvedValueOnce([{ id: 1, steamAppId: 100 }])
        .mockResolvedValueOnce([
          { id: 1, steamAppId: 100 },
          { id: 2, steamAppId: 200 },
        ])
        // fetchExistingSteamInterests
        .mockResolvedValueOnce([]);

      mockIgdbService.queryIgdb.mockResolvedValue([
        { id: 999, name: 'New Game', slug: 'new-game' },
      ]);

      // insert returns
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);

      const result = await service.syncLibrary(1);

      expect(mockIgdbService.queryIgdb).toHaveBeenCalled();
      expect(result.imported).toBe(1);
    });

    it('skips backfill when all games already matched', async () => {
      const ownedGames = [{ appid: 100, playtime_forever: 500 }];
      (steamHttp.getOwnedGames as jest.Mock).mockResolvedValue(ownedGames);

      // All matched
      mockDb.where.mockResolvedValueOnce([{ id: 1, steamAppId: 100 }]);
      // fetchExistingSteamInterests
      mockDb.where.mockResolvedValueOnce([]);
      // insert returns
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }]);

      const result = await service.syncLibrary(1);

      expect(mockIgdbService.queryIgdb).not.toHaveBeenCalled();
      expect(result.imported).toBeUndefined();
    });

    it('returns result without imported field on IGDB failure', async () => {
      const ownedGames = [
        { appid: 100, playtime_forever: 500 },
        { appid: 200, playtime_forever: 300 },
      ];
      (steamHttp.getOwnedGames as jest.Mock).mockResolvedValue(ownedGames);

      // Only appid 100 matched both times (backfill failed)
      mockDb.where
        .mockResolvedValueOnce([{ id: 1, steamAppId: 100 }])
        .mockResolvedValueOnce([{ id: 1, steamAppId: 100 }])
        .mockResolvedValueOnce([]);

      mockIgdbService.queryIgdb.mockRejectedValue(
        new Error('IGDB unavailable'),
      );

      mockDb.returning.mockResolvedValueOnce([{ id: 10 }]);

      const result = await service.syncLibrary(1);

      // Should still complete sync with matched games
      expect(result).toMatchObject({
        totalOwned: expect.any(Number),
        matched: expect.any(Number),
      });
    });
  });
});
