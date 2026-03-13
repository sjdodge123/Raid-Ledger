/**
 * Unit tests for fetchWishlistedOnSaleRow (ROK-803).
 * Covers the "Community Wishlisted On Sale" discover category.
 */
import { fetchWishlistedOnSaleRow } from './igdb-discover-deals.helpers';
import {
  buildPriceService,
  buildRedisMock,
  buildWishlistDb,
  makeItadEntry,
  makeItadEntryNoDeal,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchWishlistedOnSaleRow — filtering', () => {
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
});

describe('fetchWishlistedOnSaleRow — caching', () => {
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
