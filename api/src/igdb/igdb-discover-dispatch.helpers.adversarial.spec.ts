/**
 * Adversarial unit tests for igdb-discover-dispatch.helpers (ROK-803, ROK-818).
 * Updated: dispatchDiscoverRow no longer takes ItadPriceService.
 */
import {
  dispatchDiscoverRow,
  isDealSlug,
} from './igdb-discover-dispatch.helpers';

/** DB mock that chains all standard methods and terminates limit() with []. */
function buildEmptyChainDb() {
  const db: Record<string, jest.Mock> = {};
  const chain = [
    'select',
    'from',
    'innerJoin',
    'leftJoin',
    'orderBy',
    'groupBy',
  ];
  for (const m of chain) db[m] = jest.fn().mockReturnThis();
  db.where = jest.fn().mockReturnThis();
  db.limit = jest.fn().mockResolvedValue([]);
  return db;
}

function buildRedisMock() {
  return {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  };
}

describe('dispatchDiscoverRow — adversarial', () => {
  it('handles an unknown slug by falling through to fetchCategoryRow', async () => {
    const db = buildEmptyChainDb();
    const cat = {
      category: 'Unknown Category',
      slug: 'totally-unknown-slug-xyz',
      cached: false,
    };

    const result = await dispatchDiscoverRow(
      cat,
      db as never,
      buildRedisMock() as never,
      600,
    );

    expect(result.slug).toBe('totally-unknown-slug-xyz');
    expect(result.category).toBe('Unknown Category');
    expect(result.games).toEqual([]);
  });

  it('preserves the category label in the returned row', async () => {
    const db = buildEmptyChainDb();
    const cat = {
      category: 'Trending Multiplayer',
      slug: 'trending-multiplayer',
      cached: false,
    };

    const result = await dispatchDiscoverRow(
      cat,
      db as never,
      buildRedisMock() as never,
      300,
    );

    expect(result.category).toBe('Trending Multiplayer');
  });

  it('passes the correct cacheTtl to deal category fetches', async () => {
    const db = buildEmptyChainDb();
    const redis = buildRedisMock();
    const cat = {
      category: 'Best Price',
      slug: 'best-price',
      cached: false,
    };

    const result = await dispatchDiscoverRow(
      cat,
      db as never,
      redis as never,
      1800,
    );

    expect(result.slug).toBe('best-price');
  });
});

describe('isDealSlug — adversarial', () => {
  it('returns false for empty string', () => {
    expect(isDealSlug('')).toBe(false);
  });

  it('returns false for partial match of a deal slug', () => {
    expect(isDealSlug('wishlisted')).toBe(false);
    expect(isDealSlug('on-sale')).toBe(false);
    expect(isDealSlug('best')).toBe(false);
    expect(isDealSlug('price')).toBe(false);
  });

  it('returns false for uppercase variant of a deal slug', () => {
    expect(isDealSlug('BEST-PRICE')).toBe(false);
    expect(isDealSlug('Wishlisted-On-Sale')).toBe(false);
  });

  it('returns false for slug with extra whitespace', () => {
    expect(isDealSlug(' best-price')).toBe(false);
    expect(isDealSlug('best-price ')).toBe(false);
  });

  it('returns true for all three exact deal slugs', () => {
    const dealSlugs = [
      'wishlisted-on-sale',
      'most-played-on-sale',
      'best-price',
    ];
    for (const slug of dealSlugs) {
      expect(isDealSlug(slug)).toBe(true);
    }
  });

  it('returns false for all non-deal category slugs', () => {
    const nonDealSlugs = [
      'community-wants-to-play',
      'most-wishlisted',
      'popular-mmos',
      'top-coop',
      'trending-multiplayer',
      'recently-released',
      'highest-rated',
    ];
    for (const slug of nonDealSlugs) {
      expect(isDealSlug(slug)).toBe(false);
    }
  });
});
