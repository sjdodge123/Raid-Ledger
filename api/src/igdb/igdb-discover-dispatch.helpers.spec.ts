/**
 * Unit tests for igdb-discover-dispatch.helpers (ROK-803, ROK-818).
 * Updated: dispatchDiscoverRow no longer takes ItadPriceService.
 */
import {
  dispatchDiscoverRow,
  isDealSlug,
} from './igdb-discover-dispatch.helpers';

/** Build a DB mock that chains and returns empty results. */
function buildEmptyDb() {
  const db: Record<string, jest.Mock> = {};
  const chain = [
    'select',
    'from',
    'innerJoin',
    'leftJoin',
    'orderBy',
    'groupBy',
    'where',
  ];
  for (const m of chain) db[m] = jest.fn().mockReturnThis();
  db.limit = jest.fn().mockResolvedValue([]);
  return db;
}

/** Build a Redis mock that returns null (cache miss). */
function buildRedisMock() {
  return {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  };
}

describe('dispatchDiscoverRow', () => {
  it('returns correct slug for wishlisted-on-sale', async () => {
    const cat = {
      category: 'Community Wishlisted On Sale',
      slug: 'wishlisted-on-sale',
      cached: false,
    };
    const result = await dispatchDiscoverRow(
      cat,
      buildEmptyDb() as never,
      buildRedisMock() as never,
      600,
    );
    expect(result.slug).toBe('wishlisted-on-sale');
    expect(result.games).toEqual([]);
  });

  it('returns correct slug for most-played-on-sale', async () => {
    const cat = {
      category: 'Most Played Games On Sale',
      slug: 'most-played-on-sale',
      cached: false,
    };
    const result = await dispatchDiscoverRow(
      cat,
      buildEmptyDb() as never,
      buildRedisMock() as never,
      600,
    );
    expect(result.slug).toBe('most-played-on-sale');
    expect(result.games).toEqual([]);
  });

  it('returns correct slug for best-price', async () => {
    const db = buildEmptyDb();
    const cat = { category: 'Best Price', slug: 'best-price', cached: false };
    const result = await dispatchDiscoverRow(
      cat,
      db as never,
      buildRedisMock() as never,
      600,
    );
    expect(result.slug).toBe('best-price');
    expect(result.games).toEqual([]);
  });

  it('returns correct slug for community-wants-to-play', async () => {
    const cat = {
      category: 'Your Community Wants to Play',
      slug: 'community-wants-to-play',
      cached: false,
    };
    const result = await dispatchDiscoverRow(
      cat,
      buildEmptyDb() as never,
      buildRedisMock() as never,
      600,
    );
    expect(result.slug).toBe('community-wants-to-play');
    expect(result.games).toEqual([]);
  });

  it('returns correct slug for most-wishlisted', async () => {
    const cat = {
      category: 'Most Wishlisted',
      slug: 'most-wishlisted',
      cached: false,
    };
    const result = await dispatchDiscoverRow(
      cat,
      buildEmptyDb() as never,
      buildRedisMock() as never,
      600,
    );
    expect(result.slug).toBe('most-wishlisted');
    expect(result.games).toEqual([]);
  });

  it('falls back to fetchCategoryRow for standard slugs', async () => {
    const db = buildEmptyDb();
    const cat = {
      category: 'Highest Rated',
      slug: 'highest-rated',
      orderBy: {},
    };
    const redis = buildRedisMock();
    const result = await dispatchDiscoverRow(
      cat as never,
      db as never,
      redis as never,
      600,
    );
    expect(result.slug).toBe('highest-rated');
  });
});

describe('isDealSlug', () => {
  it('returns true for deal-aware slugs', () => {
    expect(isDealSlug('wishlisted-on-sale')).toBe(true);
    expect(isDealSlug('most-played-on-sale')).toBe(true);
    expect(isDealSlug('best-price')).toBe(true);
  });

  it('returns false for non-deal slugs', () => {
    expect(isDealSlug('most-wishlisted')).toBe(false);
    expect(isDealSlug('community-wants-to-play')).toBe(false);
    expect(isDealSlug('highest-rated')).toBe(false);
  });
});
