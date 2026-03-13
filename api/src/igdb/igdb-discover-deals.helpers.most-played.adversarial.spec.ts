/**
 * Adversarial tests for fetchMostPlayedOnSaleRow (ROK-803).
 * Edge cases: null itadGameId, mixed results, Redis failures, caching.
 */
import { fetchMostPlayedOnSaleRow } from './igdb-discover-deals.helpers';
import {
  buildPriceService,
  buildRedisMiss,
  buildRedisError,
  buildPlaytimeDb,
  makeItadEntry,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchMostPlayedOnSaleRow — adversarial: filtering', () => {
  it('skips ITAD call when all playtime games have null itadGameId', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 20, totalPlaytime: 5000 }],
      [{ id: 20, name: 'No ITAD', itadGameId: null }],
    );
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
    expect(svc.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('only includes on-sale games from mixed playtime results', async () => {
    const db = buildPlaytimeDb(
      [
        { gameId: 21, totalPlaytime: 10000 },
        { gameId: 22, totalPlaytime: 8000 },
      ],
      [
        { id: 21, name: 'Discount Game', itadGameId: 'itad-21' },
        { id: 22, name: 'Full Price Game', itadGameId: 'itad-22' },
      ],
    );
    const svc = buildPriceService([makeItadEntry('itad-21', 50)]);
    const redis = buildRedisMiss();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Discount Game');
  });
});

describe('fetchMostPlayedOnSaleRow — adversarial: caching & resilience', () => {
  it('uses correct cache key: games:discover:most-played-on-sale', async () => {
    const db = buildPlaytimeDb([], []);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.get).toHaveBeenCalledWith(
      'games:discover:most-played-on-sale',
    );
  });

  it('caches results for most-played-on-sale after fetching', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 23, totalPlaytime: 200 }],
      [{ id: 23, name: 'Cached Play Game', itadGameId: 'itad-23' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-23', 25)]);
    const redis = buildRedisMiss();

    await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.setex).toHaveBeenCalledWith(
      'games:discover:most-played-on-sale',
      CACHE_TTL,
      expect.any(String),
    );
  });

  it('survives a Redis read failure and fetches from DB', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 24, totalPlaytime: 100 }],
      [{ id: 24, name: 'Surviving Game', itadGameId: 'itad-24' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-24', 35)]);
    const redis = buildRedisError();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.slug).toBe('most-played-on-sale');
  });
});
