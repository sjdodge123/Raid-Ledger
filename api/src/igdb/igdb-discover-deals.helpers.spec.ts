/**
 * Unit tests for igdb-discover-deals.helpers (ROK-803).
 * Covers three deal-aware discover categories:
 * - Community Wishlisted On Sale
 * - Most Played Games On Sale
 * - Best Price
 */
import {
  fetchWishlistedOnSaleRow,
  fetchMostPlayedOnSaleRow,
  fetchBestPriceRow,
} from './igdb-discover-deals.helpers';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadOverviewGameEntry } from '../itad/itad-price.types';

// ─── Mock helpers ────────────────────────────────────────────────────────────

/** Build a minimal ItadPriceService mock. */
function buildPriceService(
  entries: ItadOverviewGameEntry[],
): Pick<ItadPriceService, 'getOverviewBatch'> {
  return { getOverviewBatch: jest.fn().mockResolvedValue(entries) };
}

/** Build a Redis mock with optional cached data. */
function buildRedisMock(cached: string | null = null) {
  return {
    get: jest.fn().mockResolvedValue(cached),
    setex: jest.fn().mockResolvedValue('OK'),
  };
}

/** Build a DB mock that returns wishlisted games and game rows. */
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

/** Build a DB mock that returns playtime games, game rows, and heart counts. */
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
    if (whereCallCount === 1) return db; // playtime query
    if (whereCallCount === 2) {
      // game rows from fetchAndFilterOnSale
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
    if (groupByCallCount === 1) return db; // playtime query chain
    return Promise.resolve(heartCounts); // heart count terminal
  });
  db.limit = jest.fn().mockResolvedValue(playtimeGames);
  return db;
}

/** Build a DB mock that returns games with ITAD IDs for best price. */
function buildBestPriceDb(
  gameRows: { id: number; name: string; itadGameId: string }[],
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

/** ITAD entry with a current deal at a given discount percentage. */
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

/** ITAD entry with no active deal (cut = 0). */
function makeItadEntryNoDeal(id: string): ItadOverviewGameEntry {
  return makeItadEntry(id, 0, 59.99);
}

const CACHE_TTL = 600;

// ─── fetchWishlistedOnSaleRow ────────────────────────────────────────────────

describe('fetchWishlistedOnSaleRow', () => {
  it('returns empty games when no wishlist entries', async () => {
    const db = buildWishlistDb([], []);
    const svc = buildPriceService([]);
    const redis = buildRedisMock();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.slug).toBe('wishlisted-on-sale');
    expect(result.games).toEqual([]);
  });

  it('filters out games not on sale', async () => {
    const db = buildWishlistDb(
      [{ gameId: 1, count: 5 }],
      [{ id: 1, name: 'Game A', itadGameId: 'itad-1' }],
    );
    const svc = buildPriceService([makeItadEntryNoDeal('itad-1')]);
    const redis = buildRedisMock();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });

  it('includes wishlisted games that are on sale', async () => {
    const db = buildWishlistDb(
      [{ gameId: 1, count: 5 }],
      [{ id: 1, name: 'Game A', itadGameId: 'itad-1' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-1', 50)]);
    const redis = buildRedisMock();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games.length).toBe(1);
    expect(result.category).toBe('Community Wishlisted On Sale');
  });

  it('returns cached data when available', async () => {
    const cachedGames = [{ id: 1, name: 'Cached Game' }];
    const redis = buildRedisMock(JSON.stringify(cachedGames));
    const db = buildWishlistDb([], []);
    const svc = buildPriceService([]);

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual(cachedGames);
    expect(svc.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('caches results in Redis after fetching', async () => {
    const db = buildWishlistDb(
      [{ gameId: 1, count: 5 }],
      [{ id: 1, name: 'Game A', itadGameId: 'itad-1' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-1', 50)]);
    const redis = buildRedisMock();

    await fetchWishlistedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.setex).toHaveBeenCalledWith(
      'games:discover:wishlisted-on-sale',
      CACHE_TTL,
      expect.any(String),
    );
  });
});

// ─── fetchMostPlayedOnSaleRow ────────────────────────────────────────────────

describe('fetchMostPlayedOnSaleRow', () => {
  it('returns empty games when no playtime entries', async () => {
    const db = buildPlaytimeDb([], []);
    const svc = buildPriceService([]);
    const redis = buildRedisMock();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.slug).toBe('most-played-on-sale');
    expect(result.games).toEqual([]);
  });

  it('filters out games not on sale', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 2, totalPlaytime: 1000 }],
      [{ id: 2, name: 'Game B', itadGameId: 'itad-2' }],
    );
    const svc = buildPriceService([makeItadEntryNoDeal('itad-2')]);
    const redis = buildRedisMock();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });

  it('includes most played games that are on sale', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 2, totalPlaytime: 1000 }],
      [{ id: 2, name: 'Game B', itadGameId: 'itad-2' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-2', 30)]);
    const redis = buildRedisMock();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games.length).toBe(1);
    expect(result.category).toBe('Most Played Games On Sale');
  });

  it('returns cached data when available', async () => {
    const cachedGames = [{ id: 2, name: 'Cached' }];
    const redis = buildRedisMock(JSON.stringify(cachedGames));
    const db = buildPlaytimeDb([], []);
    const svc = buildPriceService([]);

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual(cachedGames);
  });
});

// ─── fetchBestPriceRow ───────────────────────────────────────────────────────

describe('fetchBestPriceRow', () => {
  it('returns empty games when no games have ITAD IDs', async () => {
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);
    const redis = buildRedisMock();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.slug).toBe('best-price');
    expect(result.games).toEqual([]);
  });

  it('filters out games without active deals', async () => {
    const db = buildBestPriceDb([
      { id: 3, name: 'Game C', itadGameId: 'itad-3' },
    ]);
    const svc = buildPriceService([makeItadEntryNoDeal('itad-3')]);
    const redis = buildRedisMock();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });

  it('only includes games at or below historical low, sorted by hearts', async () => {
    const db = buildBestPriceDb(
      [
        { id: 3, name: 'Game C', itadGameId: 'itad-3' },
        { id: 4, name: 'Game D', itadGameId: 'itad-4' },
      ],
      [
        { gameId: 3, count: 10 },
        { gameId: 4, count: 5 },
      ],
    );
    const svc = buildPriceService([
      makeItadEntry('itad-3', 75, 14.99), // at historical low (14.99) → best price
      makeItadEntry('itad-4', 50, 29.99), // above historical low → excluded
    ]);
    const redis = buildRedisMock();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games.length).toBe(1);
    expect(result.games[0].id).toBe(3);
    expect(result.category).toBe('Best Price');
  });

  it('returns cached data when available', async () => {
    const cachedGames = [{ id: 3, name: 'Cached' }];
    const redis = buildRedisMock(JSON.stringify(cachedGames));
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual(cachedGames);
  });

  it('caches results after fetching', async () => {
    const db = buildBestPriceDb([
      { id: 3, name: 'Game C', itadGameId: 'itad-3' },
    ]);
    const svc = buildPriceService([makeItadEntry('itad-3', 75, 14.99)]);
    const redis = buildRedisMock();

    await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.setex).toHaveBeenCalledWith(
      'games:discover:best-price',
      CACHE_TTL,
      expect.any(String),
    );
  });
});
