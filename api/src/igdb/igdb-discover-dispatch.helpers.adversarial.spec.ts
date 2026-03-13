/**
 * Adversarial unit tests for igdb-discover-dispatch.helpers (ROK-803).
 * Edge cases: unknown slugs, arbitrary slug strings, isDealSlug boundaries.
 */
import {
  dispatchDiscoverRow,
  isDealSlug,
} from './igdb-discover-dispatch.helpers';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/** DB mock that chains all standard methods and terminates limit() with []. */
function buildEmptyChainDb() {
  const db: Record<string, jest.Mock> = {};
  const chain = ['select', 'from', 'innerJoin', 'orderBy', 'groupBy'];
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

function buildItadMock() {
  return { getOverviewBatch: jest.fn().mockResolvedValue([]) };
}

// ─── dispatchDiscoverRow adversarial ─────────────────────────────────────────

describe('dispatchDiscoverRow — adversarial', () => {
  it('handles an unknown slug by falling through to fetchCategoryRow', async () => {
    const db = buildEmptyChainDb();
    db.where = jest.fn().mockReturnThis();
    db.orderBy = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockResolvedValue([]);

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
      buildItadMock() as never,
    );

    expect(result.slug).toBe('totally-unknown-slug-xyz');
    expect(result.category).toBe('Unknown Category');
    expect(result.games).toEqual([]);
  });

  it('does not call ITAD service for non-deal slugs', async () => {
    const db = buildEmptyChainDb();
    db.where = jest.fn().mockReturnThis();
    db.orderBy = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockResolvedValue([]);

    const itad = buildItadMock();

    const cat = {
      category: 'Popular MMOs',
      slug: 'popular-mmos',
      cached: false,
    };

    await dispatchDiscoverRow(
      cat,
      db as never,
      buildRedisMock() as never,
      600,
      itad as never,
    );

    expect(itad.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('does not call ITAD service for community-wants-to-play', async () => {
    const db = buildEmptyChainDb();
    const itad = buildItadMock();

    const cat = {
      category: 'Your Community Wants to Play',
      slug: 'community-wants-to-play',
      cached: false,
    };

    await dispatchDiscoverRow(
      cat,
      db as never,
      buildRedisMock() as never,
      600,
      itad as never,
    );

    expect(itad.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('does not call ITAD service for most-wishlisted', async () => {
    const db = buildEmptyChainDb();
    const itad = buildItadMock();

    const cat = {
      category: 'Most Wishlisted',
      slug: 'most-wishlisted',
      cached: false,
    };

    await dispatchDiscoverRow(
      cat,
      db as never,
      buildRedisMock() as never,
      600,
      itad as never,
    );

    expect(itad.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('preserves the category label in the returned row', async () => {
    const db = buildEmptyChainDb();
    db.where = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockResolvedValue([]);

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
      buildItadMock() as never,
    );

    expect(result.category).toBe('Trending Multiplayer');
  });

  it('passes the correct cacheTtl to deal category fetches', async () => {
    // best-price calls db.select().from().where() — where() must resolve
    const db = buildEmptyChainDb();
    db.where = jest.fn().mockResolvedValue([]);
    const redis = buildRedisMock();
    const itad = buildItadMock();

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
      itad as never,
    );

    expect(result.slug).toBe('best-price');
  });
});

// ─── isDealSlug adversarial ───────────────────────────────────────────────────

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
