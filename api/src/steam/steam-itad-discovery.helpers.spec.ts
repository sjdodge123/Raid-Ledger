import {
  discoverGameViaItad,
  type DiscoveryDeps,
} from './steam-itad-discovery.helpers';
import type { ItadGame } from '../itad/itad.constants';
import type { IgdbApiGame } from '../igdb/igdb.constants';

// Mock the enrichment helper — we test it separately
jest.mock('./steam-igdb-enrichment.helpers', () => ({
  enrichFromIgdb: jest.fn(),
}));

// Mock the content filter — we test it separately
jest.mock('./steam-content-filter.helpers', () => ({
  checkAdultContent: jest.fn().mockReturnValue({ isAdult: false }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { enrichFromIgdb } = require('./steam-igdb-enrichment.helpers') as {
  enrichFromIgdb: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkAdultContent } = require('./steam-content-filter.helpers') as {
  checkAdultContent: jest.Mock;
};

const STEAM_APP_ID = 1245620;

const FAKE_ITAD_GAME: ItadGame = {
  id: 'uuid-elden',
  slug: 'elden-ring',
  title: 'Elden Ring',
  type: 'game',
  mature: false,
  assets: { boxart: 'https://img.itad.com/elden-ring-boxart.jpg' },
};

function buildMockDb() {
  const insertReturning = jest.fn();
  const insertValues = jest.fn().mockReturnValue({
    returning: insertReturning,
  });
  const insert = jest.fn().mockReturnValue({ values: insertValues });

  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set: updateSet });

  const findFirst = jest.fn();

  return {
    insert,
    insertValues,
    insertReturning,
    update,
    updateSet,
    updateWhere,
    query: { games: { findFirst } },
    // Helper to get the mock DB object matching DiscoveryDeps shape
    get asDeps() {
      return {
        insert: this.insert,
        update: this.update,
        query: this.query,
      } as unknown as DiscoveryDeps['db'];
    },
  };
}

function buildDeps(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  const mockDb = buildMockDb();
  return {
    db: mockDb.asDeps,
    lookupBySteamAppId: jest.fn(),
    adultFilterEnabled: false,
    ...overrides,
  };
}

describe('discoverGameViaItad', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkAdultContent.mockReturnValue({ isAdult: false });
    enrichFromIgdb.mockResolvedValue(null);
  });

  describe('ITAD lookup failure', () => {
    it('returns null when ITAD lookup returns null', async () => {
      const deps = buildDeps();
      (deps.lookupBySteamAppId as jest.Mock).mockResolvedValue(null);

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result).toBeNull();
    });
  });

  describe('banned slug check', () => {
    it('returns null when game slug is banned', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst.mockResolvedValue({ banned: true });

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result).toBeNull();
    });
  });

  describe('ITAD-only creation', () => {
    it('creates game row from ITAD data when no IGDB enrichment', async () => {
      const mockDb = buildMockDb();
      // isBannedBySlug => not found
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce(undefined); // upsertGame slug check
      mockDb.insertReturning.mockResolvedValue([{ id: 42 }]);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result).toEqual({
        gameId: 42,
        source: 'itad',
        hidden: false,
      });
      // Verify insert was called with ITAD-derived values
      expect(mockDb.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Elden Ring',
          slug: 'elden-ring',
          steamAppId: STEAM_APP_ID,
          itadGameId: 'uuid-elden',
          coverUrl: 'https://img.itad.com/elden-ring-boxart.jpg',
        }),
      );
    });
  });

  describe('IGDB enrichment merge', () => {
    it('merges IGDB enrichment data when available', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce(undefined); // upsertGame slug check
      mockDb.insertReturning.mockResolvedValue([{ id: 55 }]);

      enrichFromIgdb.mockResolvedValue({
        igdbId: 119133,
        name: 'Elden Ring',
        slug: 'elden-ring',
        coverUrl:
          'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg',
        summary: 'An action RPG',
        rating: 92.5,
        aggregatedRating: 95.0,
        genres: [12, 31],
        themes: [1],
        gameModes: [1, 2],
        platforms: [6, 167],
        screenshots: [],
        videos: [],
        firstReleaseDate: new Date('2022-02-25'),
        steamAppId: STEAM_APP_ID,
      });

      const queryIgdb = jest.fn() as (body: string) => Promise<IgdbApiGame[]>;
      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
        queryIgdb,
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result).toEqual({
        gameId: 55,
        source: 'itad+igdb',
        hidden: false,
      });
      // IGDB cover should override ITAD boxart
      expect(mockDb.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          igdbId: 119133,
          coverUrl:
            'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg',
          summary: 'An action RPG',
          rating: 92.5,
        }),
      );
    });

    it('skips IGDB enrichment when queryIgdb is not provided', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockDb.insertReturning.mockResolvedValue([{ id: 42 }]);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
        queryIgdb: undefined,
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.source).toBe('itad');
      expect(enrichFromIgdb).not.toHaveBeenCalled();
    });
  });

  describe('adult content filter', () => {
    it('sets hidden=true when adult filter flags the game', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockDb.insertReturning.mockResolvedValue([{ id: 77 }]);

      checkAdultContent.mockReturnValue({
        isAdult: true,
        reason: 'ITAD mature flag',
      });

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue({
          ...FAKE_ITAD_GAME,
          mature: true,
        }),
        adultFilterEnabled: true,
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result).toEqual({
        gameId: 77,
        source: 'itad',
        hidden: true,
      });
      expect(mockDb.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ hidden: true }),
      );
    });

    it('sets hidden=false when adult filter is disabled', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockDb.insertReturning.mockResolvedValue([{ id: 78 }]);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue({
          ...FAKE_ITAD_GAME,
          mature: true,
        }),
        adultFilterEnabled: false,
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.hidden).toBe(false);
    });
  });

  describe('slug merge guard', () => {
    it('does not merge when existing game has a different steamAppId', async () => {
      const mockDb = buildMockDb();
      // isBannedBySlug => not banned
      mockDb.query.games.findFirst.mockResolvedValueOnce(undefined);
      // upsertGame slug check => existing game with different steamAppId
      mockDb.query.games.findFirst.mockResolvedValueOnce({
        id: 99,
        steamAppId: 9999, // different from STEAM_APP_ID
      });
      // insertWithSlugRetry succeeds on first try
      mockDb.insertReturning.mockResolvedValue([{ id: 100 }]);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.gameId).toBe(100);
      // Should have called insert (not update) since merge was blocked
      expect(mockDb.insert).toHaveBeenCalled();
      // Should NOT have called update
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('merges into existing game when steamAppId is null', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst.mockResolvedValueOnce(undefined);
      mockDb.query.games.findFirst.mockResolvedValueOnce({
        id: 50,
        steamAppId: null,
      });

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.gameId).toBe(50);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('slug collision retry', () => {
    it('retries insert with appended steamAppId on unique violation', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce(undefined); // upsertGame slug check

      // First insert throws unique violation
      const uniqueError = new Error('unique violation');
      (uniqueError as unknown as { code: string }).code = '23505';
      mockDb.insertReturning
        .mockRejectedValueOnce(uniqueError)
        .mockResolvedValueOnce([{ id: 101 }]);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.gameId).toBe(101);
      // Second insert should use slug with appended steamAppId
      expect(mockDb.insertValues).toHaveBeenCalledTimes(2);
      expect(mockDb.insertValues).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slug: `elden-ring-${STEAM_APP_ID}`,
        }),
      );
    });

    it('throws non-unique-violation errors', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const genericError = new Error('connection lost');
      mockDb.insertReturning.mockRejectedValue(genericError);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      await expect(discoverGameViaItad(STEAM_APP_ID, deps)).rejects.toThrow(
        'connection lost',
      );
    });
  });
});
