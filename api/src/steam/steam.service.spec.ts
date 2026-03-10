import { Test } from '@nestjs/testing';
import { SteamService } from './steam.service';
import { IgdbService } from '../igdb/igdb.service';
import { ItadService } from '../itad/itad.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import * as steamHttp from './steam-http.util';

jest.mock('./steam-http.util');

describe('SteamService', () => {
  let service: SteamService;
  let mockDb: MockDb;
  let mockIgdbService: { queryIgdb: jest.Mock; upsertGamesFromApi: jest.Mock };
  let mockItadService: { lookupBySteamAppId: jest.Mock };
  let mockSettingsService: {
    getSteamApiKey: jest.Mock;
    get: jest.Mock;
  };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockIgdbService = {
      queryIgdb: jest.fn().mockResolvedValue([]),
      upsertGamesFromApi: jest.fn().mockResolvedValue([]),
    };
    mockItadService = {
      lookupBySteamAppId: jest.fn().mockResolvedValue(null),
    };
    mockSettingsService = {
      getSteamApiKey: jest.fn().mockResolvedValue('test-api-key'),
      get: jest.fn().mockResolvedValue('false'),
    };

    const module = await Test.createTestingModule({
      providers: [
        SteamService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: IgdbService, useValue: mockIgdbService },
        { provide: ItadService, useValue: mockItadService },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    service = module.get(SteamService);
  });

  describe('syncLibrary — ITAD discovery flow', () => {
    beforeEach(() => {
      mockDb.query = {
        users: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            steamId: '76561198000000001',
          }),
        },
        games: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as jest.Mock;

      (steamHttp.getPlayerSummary as jest.Mock).mockResolvedValue({
        communityvisibilitystate: 3,
      });
    });

    it('discovers unmatched games via ITAD', async () => {
      const ownedGames = [
        { appid: 100, playtime_forever: 500 },
        { appid: 200, playtime_forever: 300 },
      ];
      (steamHttp.getOwnedGames as jest.Mock).mockResolvedValue(ownedGames);

      // First findMatchingGames: only appid 100 matched
      mockDb.where.mockResolvedValueOnce([{ id: 1, steamAppId: 100 }]);

      // ITAD finds game for appid 200
      mockItadService.lookupBySteamAppId.mockResolvedValue({
        id: 'itad-uuid-200',
        slug: 'test-game',
        title: 'Test Game',
        type: 'game',
        mature: false,
        assets: { boxart: 'https://example.com/boxart.jpg' },
      });

      // Insert game row returns
      mockDb.returning.mockResolvedValueOnce([{ id: 2 }]);

      // Second findMatchingGames: both matched
      mockDb.where
        .mockResolvedValueOnce([
          { id: 1, steamAppId: 100 },
          { id: 2, steamAppId: 200 },
        ])
        // fetchExistingSteamInterests
        .mockResolvedValueOnce([]);

      // insert interests returns
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);

      const result = await service.syncLibrary(1);

      expect(mockItadService.lookupBySteamAppId).toHaveBeenCalledWith(200);
      expect(result.imported).toBe(1);
    });

    it('skips ITAD discovery when all games already matched', async () => {
      const ownedGames = [{ appid: 100, playtime_forever: 500 }];
      (steamHttp.getOwnedGames as jest.Mock).mockResolvedValue(ownedGames);

      // All matched
      mockDb.where.mockResolvedValueOnce([{ id: 1, steamAppId: 100 }]);
      // fetchExistingSteamInterests
      mockDb.where.mockResolvedValueOnce([]);
      // insert returns
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }]);

      const result = await service.syncLibrary(1);

      expect(mockItadService.lookupBySteamAppId).not.toHaveBeenCalled();
      expect(result.imported).toBeUndefined();
    });

    it('continues sync when ITAD returns null for a game', async () => {
      const ownedGames = [
        { appid: 100, playtime_forever: 500 },
        { appid: 200, playtime_forever: 300 },
      ];
      (steamHttp.getOwnedGames as jest.Mock).mockResolvedValue(ownedGames);

      // Only appid 100 matched
      mockDb.where.mockResolvedValueOnce([{ id: 1, steamAppId: 100 }]);

      // ITAD returns null (demo/playtest)
      mockItadService.lookupBySteamAppId.mockResolvedValue(null);

      // Second findMatchingGames: still only appid 100
      mockDb.where
        .mockResolvedValueOnce([{ id: 1, steamAppId: 100 }])
        // fetchExistingSteamInterests
        .mockResolvedValueOnce([]);

      // insert returns
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }]);

      const result = await service.syncLibrary(1);

      expect(result).toMatchObject({
        totalOwned: 2,
        matched: 1,
      });
    });
  });
});
