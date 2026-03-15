/**
 * Shared test fixtures for igdb-discover-deals.helpers specs (ROK-818).
 * Updated: deal helpers now query DB pricing columns, no ITAD service.
 */

export const CACHE_TTL = 600;

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

interface PartialGameInput {
  id: number;
  name: string;
  itadGameId?: string | null;
  itadCurrentCut?: number | null;
  itadCurrentPrice?: string | null;
  itadLowestPrice?: string | null;
}

/** Default IGDB/config fields for a stub game row. */
function baseGameDefaults(g: PartialGameInput) {
  return {
    id: g.id,
    name: g.name,
    slug: g.name.toLowerCase().replace(/\s+/g, '-'),
    hidden: false,
    banned: false,
    igdbId: g.id * 10,
    coverUrl: null,
    genres: [],
    cachedAt: new Date(),
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
    steamAppId: null,
    crossplay: null,
  };
}

/** Config and ITAD pricing fields for a stub game row. */
function configAndPricingDefaults(g: PartialGameInput) {
  return {
    shortName: null,
    colorHex: null,
    hasRoles: false,
    hasSpecs: false,
    enabled: true,
    itadBoxartUrl: null,
    itadTags: [],
    maxCharactersPerUser: 10,
    apiNamespacePrefix: null,
    itadGameId: g.itadGameId ?? null,
    itadCurrentCut: g.itadCurrentCut ?? null,
    itadCurrentPrice: g.itadCurrentPrice ?? null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    itadLowestPrice: g.itadLowestPrice ?? null,
    itadLowestCut: null,
    itadPriceUpdatedAt: null,
  };
}

/** Map a minimal game row to include all required fields. */
function toFullDbRow(g: PartialGameInput) {
  return { ...baseGameDefaults(g), ...configAndPricingDefaults(g) };
}

/** Build a DB mock for wishlisted-on-sale (JOIN query). */
export function buildWishlistDb(
  resultRows: {
    id: number;
    name: string;
    itadGameId?: string | null;
    itadCurrentCut?: number | null;
  }[],
) {
  const db: Record<string, jest.Mock> = {};
  const chain = ['select', 'from', 'innerJoin', 'orderBy', 'groupBy'];
  for (const m of chain) db[m] = jest.fn().mockReturnThis();
  db.where = jest.fn().mockReturnThis();
  db.limit = jest
    .fn()
    .mockResolvedValue(
      resultRows.map((r) => ({ game: toFullDbRow(r), count: 5 })),
    );
  return db;
}

/** Build a DB mock for most-played-on-sale (JOIN query). */
export function buildPlaytimeDb(
  resultRows: {
    id: number;
    name: string;
    itadGameId?: string | null;
    itadCurrentCut?: number | null;
  }[],
) {
  const db: Record<string, jest.Mock> = {};
  const chain = ['select', 'from', 'innerJoin', 'orderBy', 'groupBy'];
  for (const m of chain) db[m] = jest.fn().mockReturnThis();
  db.where = jest.fn().mockReturnThis();
  db.limit = jest.fn().mockResolvedValue(
    resultRows.map((r) => ({
      game: toFullDbRow(r),
      totalPlaytime: 1000,
    })),
  );
  return db;
}

/** Build a DB mock for best-price (LEFT JOIN with hearts). */
export function buildBestPriceDb(
  resultRows: {
    id: number;
    name: string;
    itadGameId?: string | null;
    itadCurrentCut?: number | null;
    itadCurrentPrice?: string | null;
    itadLowestPrice?: string | null;
  }[],
) {
  const db: Record<string, jest.Mock> = {};
  const chain = [
    'select',
    'from',
    'leftJoin',
    'innerJoin',
    'orderBy',
    'groupBy',
  ];
  for (const m of chain) db[m] = jest.fn().mockReturnThis();
  db.where = jest.fn().mockReturnThis();
  db.limit = jest.fn().mockResolvedValue(
    resultRows.map((r) => ({
      game: toFullDbRow(r),
      hearts: 5,
    })),
  );
  return db;
}
