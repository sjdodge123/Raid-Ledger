/**
 * Adversarial tests for fetchMostPlayedOnSaleRow (ROK-803, ROK-818).
 * Edge cases: empty DB, Redis failures, correct cache key.
 */
import { fetchMostPlayedOnSaleRow } from './igdb-discover-deals.helpers';
import {
  buildRedisMiss,
  buildRedisError,
  buildPlaytimeDb,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchMostPlayedOnSaleRow — adversarial: filtering', () => {
  it('returns empty when no games on sale in DB', async () => {
    const db = buildPlaytimeDb([]);
    const redis = buildRedisMiss();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });
});

describe('fetchMostPlayedOnSaleRow — adversarial: caching & resilience', () => {
  it('uses correct cache key: games:discover:most-played-on-sale', async () => {
    const db = buildPlaytimeDb([]);
    const redis = buildRedisMiss();

    await fetchMostPlayedOnSaleRow(db as never, redis as never, CACHE_TTL);

    expect(redis.get).toHaveBeenCalledWith(
      'games:discover:most-played-on-sale',
    );
  });

  it('caches results for most-played-on-sale after fetching', async () => {
    const db = buildPlaytimeDb([
      {
        id: 23,
        name: 'Cached Play Game',
        itadGameId: 'itad-23',
        itadCurrentCut: 25,
      },
    ]);
    const redis = buildRedisMiss();

    await fetchMostPlayedOnSaleRow(db as never, redis as never, CACHE_TTL);

    expect(redis.setex).toHaveBeenCalledWith(
      'games:discover:most-played-on-sale',
      CACHE_TTL,
      expect.any(String),
    );
  });

  it('survives a Redis read failure and fetches from DB', async () => {
    const db = buildPlaytimeDb([
      {
        id: 24,
        name: 'Surviving Game',
        itadGameId: 'itad-24',
        itadCurrentCut: 35,
      },
    ]);
    const redis = buildRedisError();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.slug).toBe('most-played-on-sale');
  });
});
