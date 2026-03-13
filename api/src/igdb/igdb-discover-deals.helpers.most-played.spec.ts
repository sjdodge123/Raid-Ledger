/**
 * Unit tests for fetchMostPlayedOnSaleRow (ROK-803).
 * Covers the "Most Played Games On Sale" discover category.
 */
import { fetchMostPlayedOnSaleRow } from './igdb-discover-deals.helpers';
import {
  buildPriceService,
  buildRedisMock,
  buildPlaytimeDb,
  makeItadEntry,
  makeItadEntryNoDeal,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchMostPlayedOnSaleRow', () => {
  it('returns empty games when no playtime entries', async () => {
    const db = buildPlaytimeDb([], []);
    const svc = buildPriceService([]);
    const redis = buildRedisMock();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.slug).toBe('most-played-on-sale');
    expect(result.games).toEqual([]);
  });

  it('filters out games not on sale', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 2, totalPlaytime: 1000 }],
      [{ id: 2, name: 'Game B', itadGameId: 'itad-2' }],
    );
    const svc = buildPriceService([makeItadEntryNoDeal('itad-2')]);
    const redis = buildRedisMock();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });

  it('includes most played games that are on sale', async () => {
    const db = buildPlaytimeDb(
      [{ gameId: 2, totalPlaytime: 1000 }],
      [{ id: 2, name: 'Game B', itadGameId: 'itad-2' }],
    );
    const svc = buildPriceService([makeItadEntry('itad-2', 30)]);
    const redis = buildRedisMock();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games.length).toBe(1);
    expect(result.category).toBe('Most Played Games On Sale');
  });

  it('returns cached data when available', async () => {
    const cachedGames = [{ id: 2, name: 'Cached' }];
    const redis = buildRedisMock(JSON.stringify(cachedGames));
    const db = buildPlaytimeDb([], []);
    const svc = buildPriceService([]);

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual(cachedGames);
  });
});
