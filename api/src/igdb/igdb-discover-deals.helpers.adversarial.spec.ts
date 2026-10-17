/**
 * Adversarial tests for fetchWishlistedOnSaleRow (ROK-803, ROK-818).
 * Edge cases: Redis failures, empty results, correct cache keys.
 */
import { fetchWishlistedOnSaleRow } from './igdb-discover-deals.helpers';
import {
  buildRedisMiss,
  buildRedisError,
  buildWishlistDb,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchWishlistedOnSaleRow — adversarial: filtering', () => {
  it('returns empty when no games on sale in DB', async () => {
    const db = buildWishlistDb([]);
    const redis = buildRedisMiss();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });
});

describe('fetchWishlistedOnSaleRow — adversarial: resilience', () => {
  it('survives a Redis read failure and fetches from DB', async () => {
    const db = buildWishlistDb([
      {
        id: 7,
        name: 'Resilient Game',
        itadGameId: 'itad-7',
        itadCurrentCut: 60,
      },
    ]);
    const redis = buildRedisError();

    const result = await fetchWishlistedOnSaleRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.slug).toBe('wishlisted-on-sale');
  });

  it('does not throw when Redis setex fails (non-fatal)', async () => {
    const db = buildWishlistDb([
      {
        id: 7,
        name: 'Resilient Game',
        itadGameId: 'itad-7',
        itadCurrentCut: 60,
      },
    ]);
    const redis = buildRedisError();

    await expect(
      fetchWishlistedOnSaleRow(db as never, redis as never, CACHE_TTL),
    ).resolves.not.toThrow();
  });

  it('uses correct cache key: games:discover:wishlisted-on-sale', async () => {
    const db = buildWishlistDb([]);
    const redis = buildRedisMiss();

    await fetchWishlistedOnSaleRow(db as never, redis as never, CACHE_TTL);

    expect(redis.get).toHaveBeenCalledWith('games:discover:wishlisted-on-sale');
  });
});
