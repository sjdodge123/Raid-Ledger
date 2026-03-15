/**
 * Unit tests for fetchBestPriceRow (ROK-803, ROK-818).
 * Updated: uses DB pricing columns instead of ITAD API calls.
 */
import { fetchBestPriceRow } from './igdb-discover-deals.helpers';
import {
  buildRedisMock,
  buildBestPriceDb,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchBestPriceRow — filtering', () => {
  it('returns empty games when no games qualify', async () => {
    const db = buildBestPriceDb([]);
    const redis = buildRedisMock();

    const result = await fetchBestPriceRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.slug).toBe('best-price');
    expect(result.games).toEqual([]);
  });

  it('includes games at or below historical low', async () => {
    const db = buildBestPriceDb([
      {
        id: 3,
        name: 'Game C',
        itadGameId: 'itad-3',
        itadCurrentCut: 75,
        itadCurrentPrice: '14.99',
        itadLowestPrice: '14.99',
      },
    ]);
    const redis = buildRedisMock();

    const result = await fetchBestPriceRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games.length).toBe(1);
    expect(result.category).toBe('Best Price');
  });
});

describe('fetchBestPriceRow — caching', () => {
  it('returns cached data when available', async () => {
    const cachedGames = [{ id: 3, name: 'Cached' }];
    const redis = buildRedisMock(JSON.stringify(cachedGames));
    const db = buildBestPriceDb([]);

    const result = await fetchBestPriceRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual(cachedGames);
  });

  it('caches results after fetching', async () => {
    const db = buildBestPriceDb([
      {
        id: 3,
        name: 'Game C',
        itadGameId: 'itad-3',
        itadCurrentCut: 75,
        itadCurrentPrice: '14.99',
        itadLowestPrice: '14.99',
      },
    ]);
    const redis = buildRedisMock();

    await fetchBestPriceRow(db as never, redis as never, CACHE_TTL);

    expect(redis.setex).toHaveBeenCalledWith(
      'games:discover:best-price',
      CACHE_TTL,
      expect.any(String),
    );
  });
});
