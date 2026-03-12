/**
 * Adversarial unit tests for igdb-discover-deals.helpers (ROK-803).
 * Edge cases: null itadGameId, Redis failures, mixed results,
 * empty ITAD responses, cap at 20, correct ITAD IDs sent.
 */
import {
  fetchWishlistedOnSaleRow,
  fetchMostPlayedOnSaleRow,
  fetchBestPriceRow,
} from './igdb-discover-deals.helpers';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadOverviewGameEntry } from '../itad/itad-price.types';

// ─── Mock helpers ────────────────────────────────────────────────────────────

function buildPriceService(
  entries: ItadOverviewGameEntry[],
): Pick<ItadPriceService, 'getOverviewBatch'> {
  return { getOverviewBatch: jest.fn().mockResolvedValue(entries) };
}

function buildRedisMiss() {
  return {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  };
}

function buildRedisError() {
  return {
    get: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
    setex: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
  };
}

/**
 * Build a wishlist DB mock that supports mixed game rows.
 * The first `.where()` call is the wishlist query (returns via `.limit()`).
 * The second `.where()` call is the games lookup (returns directly).
 */
function buildWishlistDb(
  wishlistGames: { gameId: number; count: number }[],
  gameRows: { id: number; name: string; itadGameId: string | null }[],
) {
  const db: Record<string, jest.Mock> = {};
  const chain = ['select', 'from', 'innerJoin', 'orderBy', 'groupBy'];
  for (const m of chain) db[m] = jest.fn().mockReturnThis();

  let whereCallCount = 0;
  db.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) return db;
    return Promise.resolve(
      gameRows.map((g) => ({
        ...g,
        slug: g.name.toLowerCase().replace(/\s+/g, '-'),
        hidden: false,
        banned: false,
      })),
    );
  });
  db.limit = jest.fn().mockResolvedValue(wishlistGames);
  return db;
}

function buildPlaytimeDb(
  playtimeGames: { gameId: number; totalPlaytime: number }[],
  gameRows: { id: number; name: string; itadGameId: string | null }[],
  heartCounts: { gameId: number; count: number }[] = [],
) {
  const db: Record<string, jest.Mock> = {};
  const chain = ['select', 'from', 'innerJoin', 'orderBy'];
  for (const m of chain) db[m] = jest.fn().mockReturnThis();

  let whereCallCount = 0;
  db.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) return db;
    if (whereCallCount === 2) {
      return Promise.resolve(
        gameRows.map((g) => ({
          ...g,
          slug: g.name.toLowerCase().replace(/\s+/g, '-'),
          hidden: false,
          banned: false,
        })),
      );
    }
    return db; // heart count query chain
  });
  let groupByCallCount = 0;
  db.groupBy = jest.fn().mockImplementation(() => {
    groupByCallCount++;
    if (groupByCallCount === 1) return db; // playtime query
    return Promise.resolve(heartCounts); // heart count terminal
  });
  db.limit = jest.fn().mockResolvedValue(playtimeGames);
  return db;
}

function buildBestPriceDb(
  gameRows: { id: number; name: string; itadGameId: string | null }[],
  heartCounts: { gameId: number; count: number }[] = [],
) {
  const db: Record<string, jest.Mock> = {};
  db.select = jest.fn().mockReturnThis();
  db.from = jest.fn().mockReturnThis();
  db.orderBy = jest.fn().mockReturnThis();
  let whereCallCount = 0;
  db.where = jest.fn().mockImplementation(() => {
    whereCallCount++;
    if (whereCallCount === 1) {
      return Promise.resolve(
        gameRows.map((g) => ({
          ...g,
          slug: g.name.toLowerCase().replace(/\s+/g, '-'),
          hidden: false,
          banned: false,
        })),
      );
    }
    return db; // heart count query chain
  });
  db.groupBy = jest.fn().mockResolvedValue(heartCounts);
  return db;
}

function makeItadEntry(
  id: string,
  discount: number,
  price = 29.99,
): ItadOverviewGameEntry {
  return {
    id,
    current: {
      shop: { id: 61, name: 'Steam' },
      price: {
        amount: price,
        amountInt: Math.round(price * 100),
        currency: 'USD',
      },
      regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
      cut: discount,
      url: `https://store.steampowered.com/app/${id}`,
    },
    lowest: null,
    bundled: 0,
    urls: { game: `https://isthereanydeal.com/game/${id}/` },
  };
}

/** ITAD entry at or below historical low (qualifies for "Best Price" badge). */
function makeItadEntryBestPrice(
  id: string,
  discount: number,
  price = 14.99,
): ItadOverviewGameEntry {
  return {
    id,
    current: {
      shop: { id: 61, name: 'Steam' },
      price: { amount: price, amountInt: Math.round(price * 100), currency: 'USD' },
      regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
      cut: discount,
      url: `https://store.steampowered.com/app/${id}`,
    },
    lowest: {
      shop: { id: 61, name: 'Steam' },
      price: { amount: 14.99, amountInt: 1499, currency: 'USD' },
      regular: { amount: 59.99, amountInt: 5999, currency: 'USD' },
      cut: 75,
      timestamp: '2024-11-25T00:00:00Z',
    },
    bundled: 0,
    urls: { game: `https://isthereanydeal.com/game/${id}/` },
  };
}

const CACHE_TTL = 600;

// ─── fetchWishlistedOnSaleRow adversarial ────────────────────────────────────

describe('fetchWishlistedOnSaleRow — adversarial', () => {
  it('skips ITAD call when all wishlisted games have null itadGameId', async () => {
    const db = buildWishlistDb(
      [{ gameId: 10, count: 3 }],
      [{ id: 10, name: 'No ITAD Game', itadGameId: null }],
    );
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
    // getOverviewBatch should not be called with an empty list
    expect(svc.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('returns only on-sale games from a mixed set (some with deals, some without)', async () => {
    const db = buildWishlistDb(
      [
        { gameId: 1, count: 10 },
        { gameId: 2, count: 5 },
      ],
      [
        { id: 1, name: 'On Sale Game', itadGameId: 'itad-on-sale' },
        { id: 2, name: 'Full Price Game', itadGameId: 'itad-full' },
      ],
    );
    const svc = buildPriceService([
      makeItadEntry('itad-on-sale', 40),
      // itad-full has no entry returned (simulates ITAD not knowing the game)
    ]);
    const redis = buildRedisMiss();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('On Sale Game');
  });

  it('returns empty when ITAD returns no pricing entries for any game', async () => {
    const db = buildWishlistDb(
      [{ gameId: 5, count: 2 }],
      [{ id: 5, name: 'Some Game', itadGameId: 'itad-5' }],
    );
    // ITAD returns empty pricing — no games are on sale
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
    expect(result.slug).toBe('wishlisted-on-sale');
  });

  it('survives a Redis read failure and fetches from DB', async () => {
    const db = buildWishlistDb(
      [{ gameId: 7, count: 4 }],
      [{ id: 7, name: 'Resilient Game', itadGameId: 'itad-7' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-7', 60)]);
    const redis = buildRedisError();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    // Should still return correct results despite Redis being down
    expect(result.games).toHaveLength(1);
    expect(result.slug).toBe('wishlisted-on-sale');
  });

  it('does not write to cache when Redis setex fails (non-fatal)', async () => {
    const db = buildWishlistDb(
      [{ gameId: 7, count: 4 }],
      [{ id: 7, name: 'Resilient Game', itadGameId: 'itad-7' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-7', 60)]);
    const redis = buildRedisError();

    // Should not throw even if setex fails
    await expect(
      fetchWishlistedOnSaleRow(
        db as never,
        svc as never,
        redis as never,
        CACHE_TTL,
      ),
    ).resolves.not.toThrow();
  });

  it('uses correct cache key: games:discover:wishlisted-on-sale', async () => {
    const db = buildWishlistDb([], []);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.get).toHaveBeenCalledWith('games:discover:wishlisted-on-sale');
  });
});

// ─── fetchMostPlayedOnSaleRow adversarial ────────────────────────────────────

describe('fetchMostPlayedOnSaleRow — adversarial', () => {
  it('skips ITAD call when all playtime games have null itadGameId', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 20, totalPlaytime: 5000 }],
      [{ id: 20, name: 'No ITAD', itadGameId: null }],
    );
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
    expect(svc.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('only includes on-sale games from mixed playtime results', async () => {
    const db = buildPlaytimeDb(
      [
        { gameId: 21, totalPlaytime: 10000 },
        { gameId: 22, totalPlaytime: 8000 },
      ],
      [
        { id: 21, name: 'Discount Game', itadGameId: 'itad-21' },
        { id: 22, name: 'Full Price Game', itadGameId: 'itad-22' },
      ],
    );
    const svc = buildPriceService([makeItadEntry('itad-21', 50)]);
    const redis = buildRedisMiss();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Discount Game');
  });

  it('uses correct cache key: games:discover:most-played-on-sale', async () => {
    const db = buildPlaytimeDb([], []);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.get).toHaveBeenCalledWith(
      'games:discover:most-played-on-sale',
    );
  });

  it('caches results for most-played-on-sale after fetching', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 23, totalPlaytime: 200 }],
      [{ id: 23, name: 'Cached Play Game', itadGameId: 'itad-23' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-23', 25)]);
    const redis = buildRedisMiss();

    await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.setex).toHaveBeenCalledWith(
      'games:discover:most-played-on-sale',
      CACHE_TTL,
      expect.any(String),
    );
  });

  it('survives a Redis read failure and fetches from DB', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 24, totalPlaytime: 100 }],
      [{ id: 24, name: 'Surviving Game', itadGameId: 'itad-24' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-24', 35)]);
    const redis = buildRedisError();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.slug).toBe('most-played-on-sale');
  });
});

// ─── fetchBestPriceRow adversarial ───────────────────────────────────────────

describe('fetchBestPriceRow — adversarial', () => {
  it('filters out games with null itadGameId before sending to ITAD', async () => {
    const db = buildBestPriceDb([
      { id: 30, name: 'Has ITAD', itadGameId: 'itad-30' },
      { id: 31, name: 'No ITAD', itadGameId: null },
    ]);
    const svc = buildPriceService([makeItadEntryBestPrice('itad-30', 75)]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    // ITAD was called with only the non-null ID
    expect(svc.getOverviewBatch).toHaveBeenCalledWith(['itad-30']);
    // Only the game at best price should appear
    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Has ITAD');
  });

  it('returns empty when queryGamesWithItadId returns no rows', async () => {
    // In production, queryGamesWithItadId uses isNotNull(itadGameId) in WHERE,
    // so it never returns null-itadGameId rows. We simulate an empty DB result.
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
    // No game rows returned means early exit before ITAD call
    expect(svc.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('caps results at 20 games even when more qualify', async () => {
    const gameRows = Array.from({ length: 25 }, (_, i) => ({
      id: i + 100,
      name: `Game ${i + 100}`,
      itadGameId: `itad-${i + 100}`,
    }));
    const db = buildBestPriceDb(gameRows);
    const entries = gameRows.map((g) =>
      makeItadEntryBestPrice(g.itadGameId, 75),
    );
    const svc = buildPriceService(entries);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games.length).toBeLessThanOrEqual(20);
  });

  it('sorts by heart count descending — most hearted comes first', async () => {
    const db = buildBestPriceDb(
      [
        { id: 40, name: 'Few Hearts', itadGameId: 'itad-40' },
        { id: 41, name: 'Many Hearts', itadGameId: 'itad-41' },
        { id: 42, name: 'Some Hearts', itadGameId: 'itad-42' },
      ],
      [
        { gameId: 40, count: 2 },
        { gameId: 41, count: 15 },
        { gameId: 42, count: 7 },
      ],
    );
    const svc = buildPriceService([
      makeItadEntryBestPrice('itad-40', 75),
      makeItadEntryBestPrice('itad-41', 75),
      makeItadEntryBestPrice('itad-42', 75),
    ]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games[0].name).toBe('Many Hearts');
    expect(result.games[1].name).toBe('Some Hearts');
    expect(result.games[2].name).toBe('Few Hearts');
  });

  it('returns empty when all games have 0% discount (boundary)', async () => {
    const db = buildBestPriceDb([
      { id: 50, name: 'Zero Off A', itadGameId: 'itad-50' },
      { id: 51, name: 'Zero Off B', itadGameId: 'itad-51' },
    ]);
    // Both games have cut=0, meaning NOT on sale
    const svc = buildPriceService([
      makeItadEntry('itad-50', 0),
      makeItadEntry('itad-51', 0),
    ]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });

  it('returns correct category label', async () => {
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.category).toBe('Best Price');
  });

  it('uses correct cache key: games:discover:best-price', async () => {
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.get).toHaveBeenCalledWith('games:discover:best-price');
  });

  it('survives Redis read failure and returns DB results', async () => {
    const db = buildBestPriceDb([
      { id: 60, name: 'Redis Down Game', itadGameId: 'itad-60' },
    ]);
    const svc = buildPriceService([makeItadEntryBestPrice('itad-60', 75)]);
    const redis = buildRedisError();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.slug).toBe('best-price');
  });

  it('sends the correct ITAD IDs to getOverviewBatch', async () => {
    const db = buildBestPriceDb([
      { id: 70, name: 'Alpha', itadGameId: 'app/alpha' },
      { id: 71, name: 'Beta', itadGameId: 'app/beta' },
    ]);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(svc.getOverviewBatch).toHaveBeenCalledWith([
      'app/alpha',
      'app/beta',
    ]);
  });
});
