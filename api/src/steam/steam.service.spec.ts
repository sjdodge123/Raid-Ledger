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

    it('fires ITAD discovery in the background for unmatched games', async () => {
      const ownedGames = [
        { appid: 100, playtime_forever: 500 },
        { appid: 200, playtime_forever: 300 },
      ];
      (steamHttp.getOwnedGames as jest.Mock).mockResolvedValue(ownedGames);

      // findMatchingGames: only appid 100 matched
      mockDb.where.mockResolvedValueOnce([{ id: 1, steamAppId: 100 }]);
      // fetchExistingSteamInterests
      mockDb.where.mockResolvedValueOnce([]);
      // insert interests returns
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }]);

      const result = await service.syncLibrary(1);

      // Response reflects only Phase 1 matches (no ITAD discovery in result)
      expect(result).toMatchObject({
        totalOwned: 2,
        matched: 1,
        newInterests: 1,
      });
      expect(result.imported).toBeUndefined();
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

    it('returns sync result without waiting for ITAD (ROK-782)', async () => {
      // Simulate ITAD discovery that takes a very long time
      let itadResolve: () => void;
      const slowItadPromise = new Promise<null>((resolve) => {
        itadResolve = () => resolve(null);
      });
      mockItadService.lookupBySteamAppId.mockReturnValue(slowItadPromise);

      const ownedGames = [
        { appid: 100, playtime_forever: 500 },
        { appid: 200, playtime_forever: 300 },
      ];
      (steamHttp.getOwnedGames as jest.Mock).mockResolvedValue(ownedGames);

      // Only appid 100 matched — appid 200 triggers ITAD discovery
      mockDb.where.mockResolvedValueOnce([{ id: 1, steamAppId: 100 }]);
      // fetchExistingSteamInterests
      mockDb.where.mockResolvedValueOnce([]);
      // insert interests returns
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }]);

      // syncLibrary should return immediately without waiting for ITAD
      const result = await service.syncLibrary(1);

      expect(result).toMatchObject({
        totalOwned: 2,
        matched: 1,
        newInterests: 1,
      });

      // ITAD was called but hasn't resolved yet — proving fire-and-forget
      expect(mockItadService.lookupBySteamAppId).toHaveBeenCalledWith(200);

      // Clean up: resolve the pending promise to avoid unhandled rejection
      itadResolve!();
    });

    it('logs errors from background ITAD discovery without crashing', async () => {
      mockItadService.lookupBySteamAppId.mockRejectedValue(
        new Error('ITAD API down'),
      );

      const ownedGames = [
        { appid: 100, playtime_forever: 500 },
        { appid: 200, playtime_forever: 300 },
      ];
      (steamHttp.getOwnedGames as jest.Mock).mockResolvedValue(ownedGames);

      // Only appid 100 matched
      mockDb.where.mockResolvedValueOnce([{ id: 1, steamAppId: 100 }]);
      // fetchExistingSteamInterests
      mockDb.where.mockResolvedValueOnce([]);
      // insert interests returns
      mockDb.returning.mockResolvedValueOnce([{ id: 10 }]);

      // Should not throw even though ITAD errors
      const result = await service.syncLibrary(1);

      expect(result).toMatchObject({
        totalOwned: 2,
        matched: 1,
        newInterests: 1,
      });

      // Let microtask queue flush so the .catch() handler runs
      await new Promise((r) => setImmediate(r));
    });
  });
});
