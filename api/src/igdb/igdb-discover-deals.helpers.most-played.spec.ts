/**
 * Unit tests for fetchMostPlayedOnSaleRow (ROK-803, ROK-818).
 * Updated: uses DB pricing columns instead of ITAD API calls.
 */
import { fetchMostPlayedOnSaleRow } from './igdb-discover-deals.helpers';
import {
  buildRedisMock,
  buildPlaytimeDb,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchMostPlayedOnSaleRow', () => {
  it('returns empty games when no playtime entries on sale', async () => {
    const db = buildPlaytimeDb([]);
    const redis = buildRedisMock();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.slug).toBe('most-played-on-sale');
    expect(result.games).toEqual([]);
  });

  it('includes most played games that are on sale', async () => {
    const db = buildPlaytimeDb([
      { id: 2, name: 'Game B', itadGameId: 'itad-2', itadCurrentCut: 30 },
    ]);
    const redis = buildRedisMock();

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games.length).toBe(1);
    expect(result.category).toBe('Most Played Games On Sale');
  });

  it('returns cached data when available', async () => {
    const cachedGames = [{ id: 2, name: 'Cached' }];
    const redis = buildRedisMock(JSON.stringify(cachedGames));
    const db = buildPlaytimeDb([]);

    const result = await fetchMostPlayedOnSaleRow(
      db as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual(cachedGames);
  });
});
