/**
 * Adversarial tests for fetchBestPriceRow (ROK-803, ROK-818).
 * Edge cases: empty DB, Redis failures, correct cache key.
 */
import { fetchBestPriceRow } from './igdb-discover-deals.helpers';
import {
  buildRedisMiss,
  buildRedisError,
  buildBestPriceDb,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchBestPriceRow — adversarial: filtering', () => {
  it('returns empty when no games in DB', async () => {
    const db = buildBestPriceDb([]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });

  it('returns correct category label', async () => {
    const db = buildBestPriceDb([]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.category).toBe('Best Price');
  });
});

describe('fetchBestPriceRow — adversarial: caching & resilience', () => {
  it('uses correct cache key: games:discover:best-price', async () => {
    const db = buildBestPriceDb([]);
    const redis = buildRedisMiss();

    await fetchBestPriceRow(db as never, redis as never, CACHE_TTL);

    expect(redis.get).toHaveBeenCalledWith('games:discover:best-price');
  });

  it('survives Redis read failure and returns DB results', async () => {
    const db = buildBestPriceDb([
      {
        id: 60,
        name: 'Redis Down Game',
        itadGameId: 'itad-60',
        itadCurrentCut: 75,
        itadCurrentPrice: '14.99',
        itadLowestPrice: '14.99',
      },
    ]);
    const redis = buildRedisError();

    const result = await fetchBestPriceRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.slug).toBe('best-price');
  });
});
