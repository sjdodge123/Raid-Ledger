/**
 * Unit tests for fetchWishlistedOnSaleRow (ROK-803, ROK-818).
 * Updated: uses DB pricing columns instead of ITAD API calls.
 */
import { fetchWishlistedOnSaleRow } from './igdb-discover-deals.helpers';
import {
  buildRedisMock,
  buildWishlistDb,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchWishlistedOnSaleRow — filtering', () => {
  it('returns empty games when no wishlist entries on sale', async () => {
    const db = buildWishlistDb([]);
    const redis = buildRedisMock();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.slug).toBe('wishlisted-on-sale');
    expect(result.games).toEqual([]);
  });

  it('includes wishlisted games that are on sale', async () => {
    const db = buildWishlistDb([
      { id: 1, name: 'Game A', itadGameId: 'itad-1', itadCurrentCut: 50 },
    ]);
    const redis = buildRedisMock();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
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
    const db = buildWishlistDb([]);

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual(cachedGames);
  });

  it('caches results in Redis after fetching', async () => {
    const db = buildWishlistDb([
      { id: 1, name: 'Game A', itadGameId: 'itad-1', itadCurrentCut: 50 },
    ]);
    const redis = buildRedisMock();

    await fetchWishlistedOnSaleRow(db as never, redis as never, CACHE_TTL);

    expect(redis.setex).toHaveBeenCalledWith(
      'games:discover:wishlisted-on-sale',
      CACHE_TTL,
      expect.any(String),
    );
  });
});
