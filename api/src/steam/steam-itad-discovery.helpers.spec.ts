import {
  discoverGameViaItad,
  isFullGame,
  extractPgErrorDetail,
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

  describe('DLC filtering (ROK-780)', () => {
    it('returns null for DLC-type ITAD results', async () => {
      const dlcGame: ItadGame = {
        ...FAKE_ITAD_GAME,
        type: 'dlc',
        title: 'Elden Ring - Shadow of the Erdtree',
        slug: 'elden-ring-shadow-of-the-erdtree',
      };
      const deps = buildDeps({
        lookupBySteamAppId: jest.fn().mockResolvedValue(dlcGame),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result).toBeNull();
    });

    it('returns null for expansion-type ITAD results', async () => {
      const expansionGame: ItadGame = {
        ...FAKE_ITAD_GAME,
        type: 'expansion',
        title: 'COD: BO2 Nuketown',
        slug: 'cod-bo2-nuketown',
      };
      const deps = buildDeps({
        lookupBySteamAppId: jest.fn().mockResolvedValue(expansionGame),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result).toBeNull();
    });

    it('allows game-type ITAD results through', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockDb.insertReturning.mockResolvedValue([{ id: 42 }]);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result).not.toBeNull();
      expect(result?.gameId).toBe(42);
    });

    it('allows package-type ITAD results through', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockDb.insertReturning.mockResolvedValue([{ id: 43 }]);

      const packageGame: ItadGame = {
        ...FAKE_ITAD_GAME,
        type: 'package',
        title: 'Elden Ring GOTY Edition',
        slug: 'elden-ring-goty',
      };
      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(packageGame),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result).not.toBeNull();
      expect(result?.gameId).toBe(43);
    });

    it('does not query DB when DLC is filtered out', async () => {
      const mockDb = buildMockDb();
      const dlcGame: ItadGame = { ...FAKE_ITAD_GAME, type: 'dlc' };
      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(dlcGame),
      });

      await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(mockDb.query.games.findFirst).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('isFullGame helper', () => {
    it.each(['game', 'package'])('returns true for type=%s', (type) => {
      expect(isFullGame({ ...FAKE_ITAD_GAME, type })).toBe(true);
    });

    it.each(['dlc', 'expansion', 'bundle', 'demo', ''])(
      'returns false for type=%s',
      (type) => {
        expect(isFullGame({ ...FAKE_ITAD_GAME, type })).toBe(false);
      },
    );
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

  describe('itadGameId collision (ROK-855)', () => {
    it('updates existing game when itadGameId matches but slug does not', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce(undefined) // upsertGame slug check — no match
        .mockResolvedValueOnce({ id: 200, steamAppId: null }); // itadGameId lookup — match found

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.gameId).toBe(200);
      // Should update, not insert
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('skips itadGameId lookup and normalizes empty string to null', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce(undefined); // upsertGame slug check — no match
      mockDb.insertReturning.mockResolvedValue([{ id: 300 }]);

      const noItadIdGame: ItadGame = {
        ...FAKE_ITAD_GAME,
        id: '', // empty = no ITAD game ID
      };
      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(noItadIdGame),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.gameId).toBe(300);
      // Only 2 findFirst calls (isBannedBySlug + slug check), no itadGameId lookup
      expect(mockDb.query.games.findFirst).toHaveBeenCalledTimes(2);
      // Empty string normalized to null — prevents unique constraint on empty string
      expect(mockDb.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ itadGameId: null }),
      );
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

    it('clears itadGameId and igdbId on retry to prevent cascading unique violations', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce(undefined); // upsertGame slug check

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

      // First insert throws unique violation
      const uniqueError = new Error('unique violation');
      (uniqueError as unknown as { code: string }).code = '23505';
      mockDb.insertReturning
        .mockRejectedValueOnce(uniqueError)
        .mockResolvedValueOnce([{ id: 102 }]);

      const queryIgdb = jest.fn() as (body: string) => Promise<IgdbApiGame[]>;
      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
        queryIgdb,
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.gameId).toBe(102);
      // Retry row should null out itadGameId and igdbId
      expect(mockDb.insertValues).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slug: `elden-ring-${STEAM_APP_ID}`,
          itadGameId: null,
          igdbId: null,
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

describe('extractPgErrorDetail', () => {
  it('extracts code, detail, and constraint from a PG error', () => {
    const err = Object.assign(new Error('unique violation'), {
      code: '23505',
      detail: 'Key (itad_game_id)=(abc) already exists.',
      constraint: 'games_itad_game_id_unique',
    });

    expect(extractPgErrorDetail(err)).toEqual({
      code: '23505',
      detail: 'Key (itad_game_id)=(abc) already exists.',
      constraint: 'games_itad_game_id_unique',
    });
  });

  it('extracts PG fields from nested cause', () => {
    const cause = Object.assign(new Error('pg error'), {
      code: '23505',
      detail: 'Key (slug)=(elden-ring) already exists.',
      constraint: 'games_slug_unique',
    });
    const wrapper = new Error('query failed');
    (wrapper as unknown as { cause: Error }).cause = cause;

    const result = extractPgErrorDetail(wrapper);

    expect(result).toEqual({
      code: '23505',
      detail: 'Key (slug)=(elden-ring) already exists.',
      constraint: 'games_slug_unique',
    });
  });

  it('returns null for errors without PG fields', () => {
    expect(extractPgErrorDetail(new Error('generic'))).toBeNull();
  });

  it('returns null for non-object values', () => {
    expect(extractPgErrorDetail('string error')).toBeNull();
    expect(extractPgErrorDetail(null)).toBeNull();
    expect(extractPgErrorDetail(undefined)).toBeNull();
  });

  it('returns null when code is present but detail is missing', () => {
    const err = Object.assign(new Error('pg error'), {
      code: '23505',
      // detail intentionally absent
      constraint: 'games_slug_unique',
    });

    expect(extractPgErrorDetail(err)).toBeNull();
  });

  it('returns null when detail is present but code is not a string', () => {
    const err = Object.assign(new Error('pg error'), {
      code: 23505, // number, not string
      detail: 'Key (slug)=(elden-ring) already exists.',
    });

    expect(extractPgErrorDetail(err)).toBeNull();
  });

  it('extracts PG fields from a deeply nested cause chain (3+ levels)', () => {
    const pgError = Object.assign(new Error('pg error'), {
      code: '23505',
      detail: 'Key (igdb_id)=(9999) already exists.',
      constraint: 'games_igdb_id_unique',
    });
    const level2 = Object.assign(new Error('level 2'), { cause: pgError });
    const level1 = Object.assign(new Error('level 1'), { cause: level2 });
    const root = Object.assign(new Error('root'), { cause: level1 });

    const result = extractPgErrorDetail(root);

    expect(result).toEqual({
      code: '23505',
      detail: 'Key (igdb_id)=(9999) already exists.',
      constraint: 'games_igdb_id_unique',
    });
  });

  it('returns empty string for constraint when constraint field is absent', () => {
    const err = Object.assign(new Error('pg error'), {
      code: '23514',
      detail: 'Failing row contains bad data.',
      // constraint intentionally absent
    });

    const result = extractPgErrorDetail(err);

    expect(result).toEqual({
      code: '23514',
      detail: 'Failing row contains bad data.',
      constraint: '',
    });
  });
});

// ---------------------------------------------------------------------------
// Adversarial tests (ROK-855) — edge cases and error paths
// ---------------------------------------------------------------------------

describe('discoverGameViaItad — adversarial scenarios (ROK-855)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkAdultContent.mockReturnValue({ isAdult: false });
    enrichFromIgdb.mockResolvedValue(null);
  });

  describe('itadGameId lookup throws', () => {
    it('propagates error thrown by findByItadGameId (db.query.games.findFirst)', async () => {
      const mockDb = buildMockDb();
      const lookupError = new Error('db connection lost during itad id lookup');

      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug — ok
        .mockResolvedValueOnce(undefined) // upsertGame slug check — no match
        .mockRejectedValueOnce(lookupError); // itadGameId lookup — throws

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      await expect(discoverGameViaItad(STEAM_APP_ID, deps)).rejects.toThrow(
        'db connection lost during itad id lookup',
      );
      // Should not have reached insert or update
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('mergeIntoExisting update fails', () => {
    it('propagates error thrown by db.update when merging by itadGameId', async () => {
      const mockDb = buildMockDb();
      const updateError = new Error('update constraint violation');

      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce(undefined) // upsertGame slug check — no match
        .mockResolvedValueOnce({ id: 500 }); // itadGameId lookup — found

      // Make the update chain throw
      mockDb.updateWhere.mockRejectedValueOnce(updateError);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      await expect(discoverGameViaItad(STEAM_APP_ID, deps)).rejects.toThrow(
        'update constraint violation',
      );
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('propagates error thrown by db.update when merging by slug', async () => {
      const mockDb = buildMockDb();
      const updateError = new Error('update deadlock');

      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce({ id: 600, steamAppId: null }); // slug match — merge path

      mockDb.updateWhere.mockRejectedValueOnce(updateError);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      await expect(discoverGameViaItad(STEAM_APP_ID, deps)).rejects.toThrow(
        'update deadlock',
      );
    });
  });

  describe('retry insert also gets a unique violation', () => {
    it('throws the second unique violation rather than retrying a third time', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce(undefined); // upsertGame slug check

      const firstViolation = Object.assign(new Error('unique violation #1'), {
        code: '23505',
      });
      const secondViolation = Object.assign(new Error('unique violation #2'), {
        code: '23505',
      });
      mockDb.insertReturning
        .mockRejectedValueOnce(firstViolation)
        .mockRejectedValueOnce(secondViolation);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      await expect(discoverGameViaItad(STEAM_APP_ID, deps)).rejects.toThrow(
        'unique violation #2',
      );
      // Both inserts were attempted (no third retry)
      expect(mockDb.insertValues).toHaveBeenCalledTimes(2);
    });

    it('retry insert uses suffixed slug even when the retry itself fails', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const firstViolation = Object.assign(new Error('first violation'), {
        code: '23505',
      });
      const retryViolation = Object.assign(new Error('retry violation'), {
        code: '23505',
      });
      mockDb.insertReturning
        .mockRejectedValueOnce(firstViolation)
        .mockRejectedValueOnce(retryViolation);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      await expect(discoverGameViaItad(STEAM_APP_ID, deps)).rejects.toThrow();

      // The retry attempt MUST have nulled itadGameId and igdbId
      expect(mockDb.insertValues).toHaveBeenLastCalledWith(
        expect.objectContaining({
          slug: `elden-ring-${STEAM_APP_ID}`,
          itadGameId: null,
          igdbId: null,
        }),
      );
    });
  });

  describe('slug AND itadGameId both have potential matches', () => {
    it('takes slug merge path and skips itadGameId lookup when slug matches same steamAppId', async () => {
      const mockDb = buildMockDb();

      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce({ id: 700, steamAppId: STEAM_APP_ID }); // slug match — same steamAppId

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.gameId).toBe(700);
      expect(mockDb.update).toHaveBeenCalled();
      // Only 2 findFirst calls: isBannedBySlug + slug check (no itadGameId lookup)
      expect(mockDb.query.games.findFirst).toHaveBeenCalledTimes(2);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('slug conflicts with different steamAppId triggers insert, not itadGameId merge', async () => {
      const mockDb = buildMockDb();

      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce({ id: 800, steamAppId: 9999 }); // slug match — different steamAppId

      // In this path upsertGame calls insertWithSlugRetry, which does NOT do itadGameId lookup
      mockDb.insertReturning.mockResolvedValue([{ id: 801 }]);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.gameId).toBe(801);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      // Only 2 findFirst calls — itadGameId lookup is bypassed when slug conflicts
      expect(mockDb.query.games.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('isUniqueViolation — nested cause chain', () => {
    it('detects unique violation wrapped two levels deep', async () => {
      const mockDb = buildMockDb();
      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const pgErr = Object.assign(new Error('pg unique'), { code: '23505' });
      const outerErr = Object.assign(new Error('drizzle wrapper'), {
        cause: Object.assign(new Error('inner wrapper'), { cause: pgErr }),
      });
      mockDb.insertReturning
        .mockRejectedValueOnce(outerErr)
        .mockResolvedValueOnce([{ id: 900 }]);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      // Retry should have succeeded
      expect(result?.gameId).toBe(900);
      expect(mockDb.insertValues).toHaveBeenCalledTimes(2);
    });
  });

  describe('itadGameId lookup returns null — falls through to insert', () => {
    it('proceeds to insert when itadGameId is present but no DB match found', async () => {
      const mockDb = buildMockDb();

      mockDb.query.games.findFirst
        .mockResolvedValueOnce(undefined) // isBannedBySlug
        .mockResolvedValueOnce(undefined) // upsertGame slug check — no match
        .mockResolvedValueOnce(undefined); // itadGameId lookup — no match either

      mockDb.insertReturning.mockResolvedValue([{ id: 42 }]);

      const deps = buildDeps({
        db: mockDb.asDeps,
        lookupBySteamAppId: jest.fn().mockResolvedValue(FAKE_ITAD_GAME),
      });

      const result = await discoverGameViaItad(STEAM_APP_ID, deps);

      expect(result?.gameId).toBe(42);
      // All 3 lookups happened, then insert
      expect(mockDb.query.games.findFirst).toHaveBeenCalledTimes(3);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
