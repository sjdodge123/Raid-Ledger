/**
 * Unit tests for fetchBestPriceRow (ROK-803).
 * Covers the "Best Price" discover category.
 */
import { fetchBestPriceRow } from './igdb-discover-deals.helpers';
import {
  buildPriceService,
  buildRedisMock,
  buildBestPriceDb,
  makeItadEntry,
  makeItadEntryNoDeal,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchBestPriceRow — filtering', () => {
  it('returns empty games when no games have ITAD IDs', async () => {
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);
    const redis = buildRedisMock();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.slug).toBe('best-price');
    expect(result.games).toEqual([]);
  });

  it('filters out games without active deals', async () => {
    const db = buildBestPriceDb([
      { id: 3, name: 'Game C', itadGameId: 'itad-3' },
    ]);
    const svc = buildPriceService([makeItadEntryNoDeal('itad-3')]);
    const redis = buildRedisMock();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });

  it('only includes games at or below historical low', async () => {
    const db = buildBestPriceDb(
      [
        { id: 3, name: 'Game C', itadGameId: 'itad-3' },
        { id: 4, name: 'Game D', itadGameId: 'itad-4' },
      ],
      [
        { gameId: 3, count: 10 },
        { gameId: 4, count: 5 },
      ],
    );
    const svc = buildPriceService([
      makeItadEntry('itad-3', 75, 14.99), // at historical low -> best price
      makeItadEntry('itad-4', 50, 29.99), // above historical low -> excluded
    ]);
    const redis = buildRedisMock();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games.length).toBe(1);
    expect(result.games[0].id).toBe(3);
    expect(result.category).toBe('Best Price');
  });
});

describe('fetchBestPriceRow — caching', () => {
  it('returns cached data when available', async () => {
    const cachedGames = [{ id: 3, name: 'Cached' }];
    const redis = buildRedisMock(JSON.stringify(cachedGames));
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual(cachedGames);
  });

  it('caches results after fetching', async () => {
    const db = buildBestPriceDb([
      { id: 3, name: 'Game C', itadGameId: 'itad-3' },
    ]);
    const svc = buildPriceService([makeItadEntry('itad-3', 75, 14.99)]);
    const redis = buildRedisMock();

    await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.setex).toHaveBeenCalledWith(
      'games:discover:best-price',
      CACHE_TTL,
      expect.any(String),
    );
  });
});
