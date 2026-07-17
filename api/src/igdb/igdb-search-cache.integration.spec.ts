/**
 * ITAD search-cache integration tests (ROK-1381).
 *
 * Proves the short-TTL Redis cache in front of the ITAD-primary search
 * pipeline: a second identical GET /games/search within TTL performs ZERO
 * external HTTP calls (no ITAD search/lookup POST, no IGDB external_games
 * query) and ZERO games writes, and returns the same payload. External
 * transports are spied at the service boundary; everything below the
 * pipeline (Redis, Postgres, upserts) is real.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { IgdbService } from './igdb.service';
import { ItadService } from '../itad/itad.service';
import type { IgdbApiGame } from './igdb.constants';
import type { ItadGame } from '../itad/itad.constants';

/** Minimal ITAD search result of type 'game' (survives the DLC filter). */
function fakeItadGame(title: string, slug: string): ItadGame {
  return { id: `itad-${slug}`, slug, title, type: 'game', mature: false };
}

/** Minimal IGDB enrichment row matched via external_games (category=1). */
function fakeIgdbGame(name: string, slug: string, igdbId: number): IgdbApiGame {
  return {
    id: igdbId,
    name,
    slug,
    genres: [],
    themes: [],
    external_games: [{ category: 1, uid: '730' }],
  };
}

/** Full games-table snapshot, id-ordered, for zero-writes assertions. */
async function snapshotGames(testApp: TestApp) {
  const rows = await testApp.db.select().from(schema.games);
  return [...rows].sort((a, b) => a.id - b.id);
}

describe('ITAD search cache (integration, ROK-1381)', () => {
  let testApp: TestApp;
  let itadSearchSpy: jest.SpyInstance;
  let itadInfoSpy: jest.SpyInstance;
  let itadLookupSpy: jest.SpyInstance;
  let queryIgdbSpy: jest.SpyInstance;

  /** Stub the two external transports (ITAD HTTP + IGDB HTTP). */
  function installTransportSpies(game: ItadGame, igdbGame: IgdbApiGame) {
    const itad = testApp.app.get(ItadService);
    const igdb = testApp.app.get(IgdbService);
    itadSearchSpy = jest.spyOn(itad, 'searchGames').mockResolvedValue([game]);
    itadInfoSpy = jest.spyOn(itad, 'getGameInfo').mockResolvedValue(null);
    itadLookupSpy = jest
      .spyOn(itad, 'lookupSteamAppIds')
      .mockResolvedValue(new Map([[game.id, 730]]));
    queryIgdbSpy = jest.spyOn(igdb, 'queryIgdb').mockResolvedValue([igdbGame]);
  }

  function externalCallCounts() {
    return {
      itadSearch: itadSearchSpy.mock.calls.length,
      itadInfo: itadInfoSpy.mock.calls.length,
      itadLookup: itadLookupSpy.mock.calls.length,
      queryIgdb: queryIgdbSpy.mock.calls.length,
    };
  }

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('serves a repeat query from cache: zero external calls, zero games writes, same payload', async () => {
    // Distinct query per test — ITAD cache keys are not purged by truncate.
    installTransportSpies(
      fakeItadGame('Cachetest Alpha', 'cachetest-alpha'),
      fakeIgdbGame('Cachetest Alpha', 'cachetest-alpha', 990001),
    );

    const first = await testApp.request.get('/games/search?q=cachetest alpha');
    expect(first.status).toBe(200);
    expect(first.body.meta.source).toBe('itad');
    expect(first.body.meta.cached).toBe(false);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.data[0].name).toBe('Cachetest Alpha');

    // First call exercised the full external pipeline and persisted the game.
    const countsAfterFirst = externalCallCounts();
    expect(countsAfterFirst.itadSearch).toBe(1);
    expect(countsAfterFirst.itadLookup).toBe(1);
    expect(countsAfterFirst.queryIgdb).toBe(1);
    const gamesAfterFirst = await snapshotGames(testApp);

    const second = await testApp.request.get('/games/search?q=cachetest alpha');
    expect(second.status).toBe(200);
    expect(second.body.meta.cached).toBe(true);
    expect(second.body.meta.source).toBe('redis');
    expect(second.body.data).toEqual(first.body.data);

    // ZERO additional external HTTP calls…
    expect(externalCallCounts()).toEqual(countsAfterFirst);
    // …and ZERO games writes (full-row snapshot identical).
    expect(await snapshotGames(testApp)).toEqual(gamesAfterFirst);
  });

  it('gives each adult-filter state its own cache entry (no leakage)', async () => {
    installTransportSpies(
      fakeItadGame('Cachetest Beta', 'cachetest-beta'),
      fakeIgdbGame('Cachetest Beta', 'cachetest-beta', 990002),
    );
    const igdb = testApp.app.get(IgdbService);
    const adultSpy = jest
      .spyOn(igdb, 'isAdultFilterEnabled')
      .mockResolvedValue(false);

    const first = await testApp.request.get('/games/search?q=cachetest beta');
    expect(first.status).toBe(200);
    expect(first.body.meta.source).toBe('itad');
    expect(itadSearchSpy).toHaveBeenCalledTimes(1);

    // Same query under the OTHER filter state must NOT hit the cached entry.
    adultSpy.mockResolvedValue(true);
    const filtered = await testApp.request.get(
      '/games/search?q=cachetest beta',
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.meta.source).toBe('itad');
    expect(itadSearchSpy).toHaveBeenCalledTimes(2);

    // Both states now have independent entries in the store.
    expect(
      testApp.redisMock.store.has('igdb:search:itad:adult=0:cachetest beta'),
    ).toBe(true);
    expect(
      testApp.redisMock.store.has('igdb:search:itad:adult=1:cachetest beta'),
    ).toBe(true);

    // Repeat under the second state serves from ITS entry — no external call.
    const filteredRepeat = await testApp.request.get(
      '/games/search?q=cachetest beta',
    );
    expect(filteredRepeat.status).toBe(200);
    expect(filteredRepeat.body.meta.source).toBe('redis');
    expect(itadSearchSpy).toHaveBeenCalledTimes(2);
  });
});
