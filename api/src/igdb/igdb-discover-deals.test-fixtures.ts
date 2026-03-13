/**
 * Shared test fixtures for igdb-discover-deals.helpers specs.
 * Extracted to deduplicate mock builders across split spec files.
 */
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadOverviewGameEntry } from '../itad/itad-price.types';

export const CACHE_TTL = 600;

/** Build a minimal ItadPriceService mock. */
export function buildPriceService(
  entries: ItadOverviewGameEntry[],
): Pick<ItadPriceService, 'getOverviewBatch'> {
  return { getOverviewBatch: jest.fn().mockResolvedValue(entries) };
}

/** Build a Redis mock with optional cached data. */
export function buildRedisMock(cached: string | null = null) {
  return {
    get: jest.fn().mockResolvedValue(cached),
    setex: jest.fn().mockResolvedValue('OK'),
  };
}

/** Build a Redis mock that always returns null (cache miss). */
export function buildRedisMiss() {
  return {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  };
}

/** Build a Redis mock that rejects (connection refused). */
export function buildRedisError() {
  return {
    get: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
    setex: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
  };
}

/** Map a minimal game row to include slug and visibility fields. */
function toDbRow(g: { id: number; name: string; itadGameId: string | null }) {
  return {
    ...g,
    slug: g.name.toLowerCase().replace(/\s+/g, '-'),
    hidden: false,
    banned: false,
  };
}

/** Build a DB mock that returns wishlisted games and game rows. */
export function buildWishlistDb(
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
    return Promise.resolve(gameRows.map(toDbRow));
  });
  db.limit = jest.fn().mockResolvedValue(wishlistGames);
  return db;
}

/** Build a DB mock for playtime games, game rows, and heart counts. */
export function buildPlaytimeDb(
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
    if (whereCallCount === 2) return Promise.resolve(gameRows.map(toDbRow));
    return db; // heart count query chain
  });
  let groupByCallCount = 0;
  db.groupBy = jest.fn().mockImplementation(() => {
    groupByCallCount++;
    if (groupByCallCount === 1) return db;
    return Promise.resolve(heartCounts);
  });
  db.limit = jest.fn().mockResolvedValue(playtimeGames);
  return db;
}

/** Build a DB mock for games with ITAD IDs (best price). */
export function buildBestPriceDb(
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
    if (whereCallCount === 1) return Promise.resolve(gameRows.map(toDbRow));
    return db; // heart count query chain
  });
  db.groupBy = jest.fn().mockResolvedValue(heartCounts);
  return db;
}

/** ITAD entry with a current deal at a given discount percentage. */
export function makeItadEntry(
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
export function makeItadEntryNoDeal(id: string): ItadOverviewGameEntry {
  return makeItadEntry(id, 0, 59.99);
}

/** ITAD entry with no historical low (lowest = null). */
export function makeItadEntryNoLowest(
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

/** ITAD entry at or below historical low ("Best Price" badge). */
export function makeItadEntryBestPrice(
  id: string,
  discount: number,
  price = 14.99,
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
