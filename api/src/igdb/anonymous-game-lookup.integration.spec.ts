/**
 * ROK-2325 — anonymous game lookups are local-DB-only.
 *
 * `GET /games/search` and `GET /games/by-steam-id/:id` take no JWT. Before
 * this fix an anonymous caller drove the ITAD-primary search (a `getGameInfo`
 * per hit plus a `games` upsert per result) and ITAD Steam discovery (a
 * `games` insert plus an IGDB re-enrich job) — throttled only per IP, and not
 * at all under DEMO_MODE. Anonymous callers now read the local DB only;
 * signed-in callers keep discovery. ITAD/IGDB are spied at the service
 * boundary; Postgres, the controller and the pipeline below them are real.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { ItadService } from '../itad/itad.service';
import { IgdbService } from './igdb.service';
import type { ItadGame } from '../itad/itad.constants';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

function itadGame(slug: string, title: string): ItadGame {
  return { id: `itad-${slug}`, slug, title, type: 'game', mature: false };
}

/** Spy every external call either route can make; nothing reaches a network. */
function spyProviders(hit: ItadGame) {
  const itad = testApp.app.get(ItadService);
  const igdb = testApp.app.get(IgdbService);
  return {
    searchItad: jest.spyOn(itad, 'searchGames').mockResolvedValue([hit]),
    gameInfo: jest.spyOn(itad, 'getGameInfo').mockResolvedValue(null),
    steamIds: jest
      .spyOn(itad, 'lookupSteamAppIds')
      .mockResolvedValue(new Map()),
    bySteamId: jest.spyOn(itad, 'lookupBySteamAppId').mockResolvedValue(hit),
    reenrich: jest.spyOn(igdb, 'enqueueReenrich').mockResolvedValue(),
    fullSearch: jest.spyOn(igdb, 'searchGames'),
  };
}

async function gameNames(): Promise<string[]> {
  const rows = await testApp.db
    .select({ name: schema.games.name })
    .from(schema.games);
  return rows.map((r) => r.name).sort();
}

/** A query no earlier run cached in the ITAD search cache (Redis). */
function uniqueQuery(): string {
  return `rokanon${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

describe('ROK-2325 GET /games/search', () => {
  it('anonymous: serves local matches, calls no provider, writes no games row', async () => {
    const q = uniqueQuery();
    await testApp.db
      .insert(schema.games)
      .values({ name: `${q} Local`, slug: `${q}-local` });
    const before = await gameNames();
    const spies = spyProviders(itadGame(`${q}-itad`, `${q} Itad`));

    const res = await testApp.request.get('/games/search').query({ q });

    expect(res.status).toBe(200);
    const names = (res.body.data as { name: string }[]).map((g) => g.name);
    expect(names).toEqual([`${q} Local`]);
    expect(res.body.meta.source).toBe('local');
    expect(spies.fullSearch).not.toHaveBeenCalled();
    expect(spies.searchItad).not.toHaveBeenCalled();
    expect(spies.gameInfo).not.toHaveBeenCalled();
    expect(await gameNames()).toEqual(before);
  });

  it('signed in: still runs the ITAD pipeline and persists the hit', async () => {
    const q = uniqueQuery();
    const spies = spyProviders(itadGame(`${q}-itad`, `${q} Itad`));

    const res = await testApp.request
      .get('/games/search')
      .query({ q })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.source).toBe('itad');
    expect(spies.searchItad).toHaveBeenCalledTimes(1);
    expect(spies.gameInfo).toHaveBeenCalledTimes(1);
    expect(await gameNames()).toContain(`${q} Itad`);
  });
});

describe('ROK-2325 GET /games/by-steam-id/:id', () => {
  it('anonymous: an unknown app id 404s without ITAD discovery, insert or job', async () => {
    const before = await gameNames();
    const spies = spyProviders(itadGame('rok2325-steam', 'Rok2325 Steam'));

    const res = await testApp.request.get('/games/by-steam-id/232501');

    expect(res.status).toBe(404);
    expect(spies.bySteamId).not.toHaveBeenCalled();
    expect(spies.reenrich).not.toHaveBeenCalled();
    expect(await gameNames()).toEqual(before);
  });

  it('anonymous: a known app id still resolves from the local DB', async () => {
    await testApp.db.insert(schema.games).values({
      name: 'Rok2325 Known',
      slug: 'rok2325-known',
      steamAppId: 232502,
    });
    const spies = spyProviders(itadGame('rok2325-other', 'Rok2325 Other'));

    const res = await testApp.request.get('/games/by-steam-id/232502');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Rok2325 Known');
    expect(spies.bySteamId).not.toHaveBeenCalled();
  });

  it('signed in: an unknown app id is discovered, inserted and re-enriched', async () => {
    const spies = spyProviders(itadGame('rok2325-found', 'Rok2325 Found'));

    const res = await testApp.request
      .get('/games/by-steam-id/232503')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Rok2325 Found');
    expect(spies.bySteamId).toHaveBeenCalledWith(232503, expect.anything());
    expect(spies.reenrich).toHaveBeenCalledWith(res.body.id);
    expect(await gameNames()).toContain('Rok2325 Found');
  });
});
