/**
 * Unit tests for ITAD game upsert pre-check logic (ROK-1008 AC 8).
 *
 * Tests that upsertItadGame prevents duplicate rows when ITAD and IGDB
 * slugs differ by finding existing rows via steamAppId or igdbId before
 * falling through to normal slug-based upsert.
 *
 * Uses a custom mock builder because the upsert helper chains
 * select().from().where().limit() (where must return mock for chaining)
 * AND update().set().where() (where terminates the chain).
 * The flat mock can't handle both patterns on the same `where` method.
 */
import { upsertItadGame } from './igdb-itad-upsert.helpers';

// ─── Test data builders ───────────────────────────────────────────────────

/** Build a minimal GameDetailDto-like object with defaults. */
function makeGameDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 0,
    igdbId: null,
    name: 'Test Game',
    slug: 'test-game',
    coverUrl: null,
    genres: [],
    summary: null,
    rating: null,
    aggregatedRating: null,
    popularity: null,
    gameModes: [],
    themes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    firstReleaseDate: null,
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
    ...overrides,
  };
}

/** Build a mock DB row matching the games table shape. */
function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    igdbId: null,
    name: 'Test Game',
    slug: 'test-game',
    coverUrl: null,
    genres: [],
    summary: null,
    rating: null,
    aggregatedRating: null,
    popularity: null,
    gameModes: [],
    themes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    firstReleaseDate: null,
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
    cachedAt: new Date(),
    steamAppId: null,
    hidden: false,
    banned: false,
    shortName: null,
    colorHex: null,
    hasRoles: false,
    hasSpecs: false,
    enabled: true,
    itadGameId: null,
    itadBoxartUrl: null,
    itadTags: [],
    maxCharactersPerUser: 10,
    apiNamespacePrefix: null,
    itadCurrentPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    itadLowestPrice: null,
    itadLowestCut: null,
    itadPriceUpdatedAt: null,
    earlyAccess: false,
    igdbEnrichmentStatus: 'pending',
    igdbEnrichmentRetryCount: 0,
    ...overrides,
  };
}

// ─── Mock builder ─────────────────────────────────────────────────────────

/**
 * Build a mock DB that supports the upsert helper's query patterns:
 *  - SELECT queries: select().from().where().limit() (limit terminates)
 *  - UPDATE queries: update().set().where() (where terminates)
 *  - INSERT queries: insert().values().onConflictDoUpdate() (terminates)
 *
 * @param limitResults - Sequential results for .limit() calls
 */
function buildUpsertDb(limitResults: unknown[][]) {
  const db: Record<string, jest.Mock> = {};
  const chainMethods = [
    'select',
    'from',
    'innerJoin',
    'leftJoin',
    'orderBy',
    'groupBy',
    'insert',
    'values',
    'update',
    'set',
    'onConflictDoUpdate',
    'onConflictDoNothing',
    'returning',
    'execute',
  ];

  for (const m of chainMethods) {
    db[m] = jest.fn().mockReturnValue(db);
  }

  // limit() is terminal for SELECT queries
  let limitCallIdx = 0;
  db.limit = jest.fn().mockImplementation(() => {
    const result = limitResults[limitCallIdx] ?? [];
    limitCallIdx++;
    return Promise.resolve(result);
  });

  // where() serves two roles:
  // - Chain step in SELECT (returns db for further chaining)
  // - Terminal in UPDATE (returns resolved Promise)
  // We detect which by checking if update() was called before where()
  let inUpdate = false;
  const origUpdate = db.update;
  db.update = jest.fn().mockImplementation((...args: unknown[]) => {
    inUpdate = true;
    return origUpdate(...args);
  });

  db.where = jest.fn().mockImplementation(() => {
    if (inUpdate) {
      inUpdate = false;
      return Promise.resolve(undefined);
    }
    return db;
  });

  db.transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: typeof db) => unknown) => cb(db));
  db.delete = jest.fn().mockReturnValue(db);

  return db;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('upsertItadGame', () => {
  describe('AC 8: pre-check by steamAppId', () => {
    it('updates existing row when steamAppId matches', async () => {
      const game = makeGameDto({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        steamAppId: 646570,
        itadGameId: 'itad-uuid-1',
      });
      const existingRow = makeDbRow({
        id: 42,
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        steamAppId: 646570,
        igdbId: 12345,
      });

      // limit(1) calls:
      // 1. findExistingByAltKey steamAppId query -> match
      // 2. fetchBySlug after update -> return existing row
      const db = buildUpsertDb([[existingRow], [existingRow]]);

      const result = await upsertItadGame(db as never, game as never);

      expect(db.update).toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        id: expect.any(Number),
        slug: 'slay-the-spire-ii',
      });
    });
  });

  describe('AC 8: pre-check by igdbId', () => {
    it('updates existing row when igdbId matches', async () => {
      const game = makeGameDto({
        name: 'Slay the Spire 2',
        slug: 'slay-the-spire-2',
        igdbId: 12345,
        itadGameId: 'itad-uuid-1',
      });
      const existingRow = makeDbRow({
        id: 99,
        name: 'Slay the Spire II',
        slug: 'slay-the-spire-ii',
        igdbId: 12345,
      });

      // limit(1) calls:
      // 1. findExistingByAltKey igdbId query -> match
      //    (no steamAppId on game, so steamAppId branch is skipped)
      // 2. fetchBySlug after update -> return existing row
      const db = buildUpsertDb([[existingRow], [existingRow]]);

      const result = await upsertItadGame(db as never, game as never);

      expect(db.update).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: expect.any(Number),
        slug: 'slay-the-spire-ii',
      });
    });

    it('checks igdbId after steamAppId finds no match', async () => {
      const game = makeGameDto({
        name: 'Game X',
        slug: 'game-x-itad',
        steamAppId: 99999,
        igdbId: 500,
        itadGameId: 'itad-x',
      });
      const existingRow = makeDbRow({
        id: 77,
        slug: 'game-x-igdb',
        igdbId: 500,
      });

      // limit(1) calls:
      // 1. steamAppId query -> no match
      // 2. igdbId query -> match
      // 3. fetchBySlug after update -> return row
      const db = buildUpsertDb([[], [existingRow], [existingRow]]);

      const result = await upsertItadGame(db as never, game as never);

      expect(db.update).toHaveBeenCalled();
      expect(result).toMatchObject({ slug: 'game-x-igdb' });
    });
  });

  describe('AC 8: falls through to slug-based upsert', () => {
    it('inserts when no match by steamAppId or igdbId', async () => {
      const game = makeGameDto({
        name: 'Brand New Game',
        slug: 'brand-new-game',
        steamAppId: 11111,
        igdbId: 222,
        itadGameId: 'itad-new',
      });
      const insertedRow = makeDbRow({
        id: 50,
        name: 'Brand New Game',
        slug: 'brand-new-game',
        steamAppId: 11111,
        igdbId: 222,
        itadGameId: 'itad-new',
      });

      // limit(1) calls:
      // 1. steamAppId query -> no match
      // 2. igdbId query -> no match
      // 3. fetchBySlug after insert -> return new row
      const db = buildUpsertDb([[], [], [insertedRow]]);

      const result = await upsertItadGame(db as never, game as never);

      expect(db.insert).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: expect.any(Number),
        slug: 'brand-new-game',
      });
    });

    it('skips alt key checks when game has no keys', async () => {
      const game = makeGameDto({
        name: 'ITAD Only Game',
        slug: 'itad-only-game',
        igdbId: null,
        itadGameId: 'itad-only',
      });
      const insertedRow = makeDbRow({
        id: 60,
        slug: 'itad-only-game',
        itadGameId: 'itad-only',
      });

      // limit(1) calls:
      // No steamAppId or igdbId so findExistingByAltKey skips both
      // 1. fetchBySlug after insert -> return row
      const db = buildUpsertDb([[insertedRow]]);

      const result = await upsertItadGame(db as never, game as never);

      expect(db.insert).toHaveBeenCalled();
      expect(result).toMatchObject({ slug: 'itad-only-game' });
    });
  });

  describe('edge cases', () => {
    it('steamAppId match short-circuits igdbId check', async () => {
      const game = makeGameDto({
        name: 'Dual-key Game',
        slug: 'dual-key-itad',
        steamAppId: 777,
        igdbId: 888,
      });
      const existingRow = makeDbRow({
        id: 33,
        slug: 'dual-key-igdb',
        steamAppId: 777,
        igdbId: 888,
      });

      // limit(1) calls:
      // 1. steamAppId query -> match (skips igdbId check)
      // 2. fetchBySlug after update
      const db = buildUpsertDb([[existingRow], [existingRow]]);

      const result = await upsertItadGame(db as never, game as never);

      expect(db.update).toHaveBeenCalled();
      expect(db.limit).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ slug: 'dual-key-igdb' });
    });

    it('returns mapped GameDetailDto from fetched row', async () => {
      const game = makeGameDto({
        name: 'Mapped Game',
        slug: 'mapped-game-itad',
        steamAppId: 555,
      });
      const existingRow = makeDbRow({
        id: 10,
        slug: 'mapped-game-igdb',
        name: 'Mapped Game DB',
        steamAppId: 555,
        igdbId: 600,
        genres: [12, 31],
        summary: 'A mapped summary',
      });

      const db = buildUpsertDb([[existingRow], [existingRow]]);

      const result = await upsertItadGame(db as never, game as never);

      // Verify the result is a properly mapped GameDetailDto
      expect(result).toMatchObject({
        id: 10,
        igdbId: 600,
        name: 'Mapped Game DB',
        slug: 'mapped-game-igdb',
        genres: [12, 31],
        summary: 'A mapped summary',
      });
    });
  });
});
