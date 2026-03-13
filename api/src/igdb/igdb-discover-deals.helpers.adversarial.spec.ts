/**
 * Adversarial tests for fetchWishlistedOnSaleRow (ROK-803).
 * Edge cases: null itadGameId, Redis failures, mixed results, empty ITAD responses.
 */
import { fetchWishlistedOnSaleRow } from './igdb-discover-deals.helpers';
import {
  buildPriceService,
  buildRedisMiss,
  buildRedisError,
  buildWishlistDb,
  makeItadEntry,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchWishlistedOnSaleRow — adversarial: filtering', () => {
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
    expect(svc.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('returns only on-sale games from a mixed set', async () => {
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
    const svc = buildPriceService([makeItadEntry('itad-on-sale', 40)]);
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

  it('returns empty when ITAD returns no pricing entries', async () => {
    const db = buildWishlistDb(
      [{ gameId: 5, count: 2 }],
      [{ id: 5, name: 'Some Game', itadGameId: 'itad-5' }],
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
    expect(result.slug).toBe('wishlisted-on-sale');
  });
});

describe('fetchWishlistedOnSaleRow — adversarial: resilience', () => {
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

    expect(result.games).toHaveLength(1);
    expect(result.slug).toBe('wishlisted-on-sale');
  });

  it('does not throw when Redis setex fails (non-fatal)', async () => {
    const db = buildWishlistDb(
      [{ gameId: 7, count: 4 }],
      [{ id: 7, name: 'Resilient Game', itadGameId: 'itad-7' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-7', 60)]);
    const redis = buildRedisError();

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
