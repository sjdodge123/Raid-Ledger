/**
 * Adversarial tests for fetchBestPriceRow (ROK-803).
 * Edge cases: null itadGameId, cap at 20, heart sorting, 0% discount,
 * correct ITAD IDs, Redis failures.
 */
import { fetchBestPriceRow } from './igdb-discover-deals.helpers';
import {
  buildPriceService,
  buildRedisMiss,
  buildRedisError,
  buildBestPriceDb,
  makeItadEntryNoLowest,
  makeItadEntryBestPrice,
  CACHE_TTL,
} from './igdb-discover-deals.test-fixtures';

describe('fetchBestPriceRow — adversarial: filtering', () => {
  it('filters out games with null itadGameId before sending to ITAD', async () => {
    const db = buildBestPriceDb([
      { id: 30, name: 'Has ITAD', itadGameId: 'itad-30' },
      { id: 31, name: 'No ITAD', itadGameId: null },
    ]);
    const svc = buildPriceService([makeItadEntryBestPrice('itad-30', 75)]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(svc.getOverviewBatch).toHaveBeenCalledWith(['itad-30']);
    expect(result.games).toHaveLength(1);
    expect(result.games[0].name).toBe('Has ITAD');
  });

  it('returns empty when queryGamesWithItadId returns no rows', async () => {
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
    expect(svc.getOverviewBatch).not.toHaveBeenCalled();
  });

  it('returns empty when all games have 0% discount (boundary)', async () => {
    const db = buildBestPriceDb([
      { id: 50, name: 'Zero Off A', itadGameId: 'itad-50' },
      { id: 51, name: 'Zero Off B', itadGameId: 'itad-51' },
    ]);
    const svc = buildPriceService([
      makeItadEntryNoLowest('itad-50', 0),
      makeItadEntryNoLowest('itad-51', 0),
    ]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toEqual([]);
  });
});

describe('fetchBestPriceRow — adversarial: sorting & limits', () => {
  it('caps results at 20 games even when more qualify', async () => {
    const gameRows = Array.from({ length: 25 }, (_, i) => ({
      id: i + 100,
      name: `Game ${i + 100}`,
      itadGameId: `itad-${i + 100}`,
    }));
    const db = buildBestPriceDb(gameRows);
    const entries = gameRows.map((g) =>
      makeItadEntryBestPrice(g.itadGameId, 75),
    );
    const svc = buildPriceService(entries);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games.length).toBeLessThanOrEqual(20);
  });

  it('sorts by heart count descending — most hearted comes first', async () => {
    const db = buildBestPriceDb(
      [
        { id: 40, name: 'Few Hearts', itadGameId: 'itad-40' },
        { id: 41, name: 'Many Hearts', itadGameId: 'itad-41' },
        { id: 42, name: 'Some Hearts', itadGameId: 'itad-42' },
      ],
      [
        { gameId: 40, count: 2 },
        { gameId: 41, count: 15 },
        { gameId: 42, count: 7 },
      ],
    );
    const svc = buildPriceService([
      makeItadEntryBestPrice('itad-40', 75),
      makeItadEntryBestPrice('itad-41', 75),
      makeItadEntryBestPrice('itad-42', 75),
    ]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games[0].name).toBe('Many Hearts');
    expect(result.games[1].name).toBe('Some Hearts');
    expect(result.games[2].name).toBe('Few Hearts');
  });
});

describe('fetchBestPriceRow — adversarial: caching & resilience', () => {
  it('returns correct category label', async () => {
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.category).toBe('Best Price');
  });

  it('uses correct cache key: games:discover:best-price', async () => {
    const db = buildBestPriceDb([]);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(redis.get).toHaveBeenCalledWith('games:discover:best-price');
  });

  it('survives Redis read failure and returns DB results', async () => {
    const db = buildBestPriceDb([
      { id: 60, name: 'Redis Down Game', itadGameId: 'itad-60' },
    ]);
    const svc = buildPriceService([makeItadEntryBestPrice('itad-60', 75)]);
    const redis = buildRedisError();

    const result = await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(result.games).toHaveLength(1);
    expect(result.slug).toBe('best-price');
  });

  it('sends the correct ITAD IDs to getOverviewBatch', async () => {
    const db = buildBestPriceDb([
      { id: 70, name: 'Alpha', itadGameId: 'app/alpha' },
      { id: 71, name: 'Beta', itadGameId: 'app/beta' },
    ]);
    const svc = buildPriceService([]);
    const redis = buildRedisMiss();

    await fetchBestPriceRow(
      db as never,
      svc as never,
      redis as never,
      CACHE_TTL,
    );

    expect(svc.getOverviewBatch).toHaveBeenCalledWith([
      'app/alpha',
      'app/beta',
    ]);
  });
});
