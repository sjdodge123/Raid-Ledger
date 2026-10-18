/**
 * ROK-1843: Steam/ITAD discovery must never un-hide or rewrite a game an
 * admin hid or banned.
 *
 * Attack: an anonymous GET /games/by-steam-id/<appId> (or a wishlist/library
 * sync, or a search whose ITAD hit maps onto the row) used to rebuild the row
 * with `hidden=false` and merge it over the moderated one, so the game came
 * back for everyone. External transports (ITAD, IGDB) are spied at the
 * service boundary; Postgres and the merge/upsert code below them are real.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { ItadService } from '../itad/itad.service';
import { IgdbService } from '../igdb/igdb.service';
import type { ItadGame } from '../itad/itad.constants';
import {
  discoverGameViaItad,
  type DiscoveryDeps,
} from './steam-itad-discovery.helpers';

type GameRow = typeof schema.games.$inferSelect;

function itadGame(slug: string, title: string, id = `itad-${slug}`): ItadGame {
  return { id, slug, title, type: 'game', mature: false };
}

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

async function insertGame(
  values: Partial<typeof schema.games.$inferInsert> & { slug: string },
): Promise<GameRow> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: values.slug, ...values })
      .returning(),
    'inserted game',
  );
  return row;
}

async function reload(id: number): Promise<GameRow> {
  const rows = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, id));
  return nonEmpty(rows, `game ${id}`)[0];
}

/** The deps a Steam wishlist/library sync hands to discovery. */
function syncDeps(game: ItadGame, adultFilterEnabled = false): DiscoveryDeps {
  return {
    db: testApp.db,
    lookupBySteamAppId: jest.fn().mockResolvedValue(game),
    adultFilterEnabled,
  };
}

describe('ROK-1843 by-steam-id never rediscovers a moderated game', () => {
  it('a hidden game stays hidden and the anonymous lookup 404s', async () => {
    const hidden = await insertGame({
      slug: 'rok1843-hidden',
      name: 'Rok1843 Hidden',
      steamAppId: 184301,
      hidden: true,
    });
    const lookupSpy = jest
      .spyOn(testApp.app.get(ItadService), 'lookupBySteamAppId')
      .mockResolvedValue(itadGame('rok1843-hidden', 'Rok1843 Hidden'));

    const res = await testApp.request.get('/games/by-steam-id/184301');

    expect(res.status).toBe(404);
    expect((await reload(hidden.id)).hidden).toBe(true);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('a banned game 404s and is not rewritten', async () => {
    const banned = await insertGame({
      slug: 'rok1843-banned',
      name: 'Rok1843 Banned',
      steamAppId: 184302,
      banned: true,
    });
    jest
      .spyOn(testApp.app.get(ItadService), 'lookupBySteamAppId')
      .mockResolvedValue(itadGame('rok1843-banned-other', 'Rok1843 Banned'));

    const res = await testApp.request.get('/games/by-steam-id/184302');

    expect(res.status).toBe(404);
    expect(await reload(banned.id)).toEqual(banned);
  });

  it('a discovery that merges into a hidden row (by name) 404s and keeps it hidden', async () => {
    const hidden = await insertGame({
      slug: 'rok1843-name-hidden',
      name: 'Rok1843 Name Hidden',
      hidden: true,
    });
    jest
      .spyOn(testApp.app.get(ItadService), 'lookupBySteamAppId')
      .mockResolvedValue(
        itadGame('rok1843-name-hidden-itad', 'Rok1843 Name Hidden'),
      );

    const res = await testApp.request.get('/games/by-steam-id/184303');

    expect(res.status).toBe(404);
    expect((await reload(hidden.id)).hidden).toBe(true);
  });
});

describe('ROK-1843 sync merges keep moderation state', () => {
  it('a wishlist-sync merge (by slug) keeps hidden=true', async () => {
    const hidden = await insertGame({
      slug: 'rok1843-wish',
      name: 'Rok1843 Wish',
      steamAppId: 184311,
      hidden: true,
    });

    const result = await discoverGameViaItad(
      184311,
      syncDeps(itadGame('rok1843-wish', 'Rok1843 Wish')),
      'steam',
    );

    expect(result).toEqual(
      expect.objectContaining({ gameId: hidden.id, hidden: true }),
    );
    expect((await reload(hidden.id)).hidden).toBe(true);
  });

  it('a merge matched by itadGameId keeps hidden=true', async () => {
    const hidden = await insertGame({
      slug: 'rok1843-itad-hidden-igdb',
      name: 'Rok1843 Itad Hidden (IGDB)',
      itadGameId: 'itad-rok1843-shared',
      hidden: true,
    });

    await discoverGameViaItad(
      184312,
      syncDeps(
        itadGame('rok1843-itad-hidden', 'Rok1843 Itad', 'itad-rok1843-shared'),
      ),
      'steam',
    );

    expect((await reload(hidden.id)).hidden).toBe(true);
  });

  it('skips a banned row matched by itadGameId: no write, no result', async () => {
    const banned = await insertGame({
      slug: 'rok1843-itad-banned-igdb',
      name: 'Rok1843 Itad Banned (IGDB)',
      itadGameId: 'itad-rok1843-banned',
      banned: true,
    });

    const result = await discoverGameViaItad(
      184313,
      syncDeps(
        itadGame('rok1843-itad-banned', 'Rok1843 Ib', 'itad-rok1843-banned'),
      ),
      'steam',
    );

    expect(result).toBeNull();
    expect(await reload(banned.id)).toEqual(banned);
  });

  it('skips a banned row matched by normalized name: no write, no result', async () => {
    const banned = await insertGame({
      slug: 'rok1843-name-banned',
      name: 'Rok1843 Name Banned',
      banned: true,
    });

    const result = await discoverGameViaItad(
      184314,
      syncDeps(itadGame('rok1843-name-banned-itad', 'Rok1843 Name Banned')),
      'steam',
    );

    expect(result).toBeNull();
    expect(await reload(banned.id)).toEqual(banned);
  });

  it('does not overwrite a non-null itadGameId on merge', async () => {
    const existing = await insertGame({
      slug: 'rok1843-keep-itad',
      name: 'Rok1843 Keep Itad',
      itadGameId: 'itad-rok1843-original',
    });

    await discoverGameViaItad(
      184315,
      syncDeps(
        itadGame('rok1843-keep-itad', 'Rok1843 Keep Itad', 'itad-rok1843-new'),
      ),
      'steam',
    );

    const after = await reload(existing.id);
    expect(after.itadGameId).toBe('itad-rok1843-original');
    expect(after.steamAppId).toBe(184315);
  });
});

describe('ROK-1843 ITAD search never returns or rewrites a moderated row', () => {
  function stubSearch(game: ItadGame, steamAppId: number): void {
    const itad = testApp.app.get(ItadService);
    const igdb = testApp.app.get(IgdbService);
    jest.spyOn(itad, 'searchGames').mockResolvedValue([game]);
    jest.spyOn(itad, 'getGameInfo').mockResolvedValue(null);
    jest
      .spyOn(itad, 'lookupSteamAppIds')
      .mockResolvedValue(new Map([[game.id, steamAppId]]));
    jest.spyOn(igdb, 'queryIgdb').mockResolvedValue([]);
    jest.spyOn(igdb, 'isAdultFilterEnabled').mockResolvedValue(false);
  }

  it.each([
    ['banned', { banned: true }],
    ['hidden', { hidden: true }],
  ])(
    'a %s row matched by steamAppId is not returned and not rewritten',
    async (label, moderation) => {
      const appId = label === 'banned' ? 184321 : 184322;
      const moderated = await insertGame({
        slug: `rok1843-search-${label}`,
        name: `Rok1843 Search ${label}`,
        steamAppId: appId,
        ...moderation,
      });
      stubSearch(itadGame(`rok1843-zq-${label}`, `Rok1843 Zq ${label}`), appId);

      const res = await testApp.request.get(
        `/games/search?q=rok1843 zq ${label}`,
      );

      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: number }[]).map((g) => g.id);
      expect(ids).not.toContain(moderated.id);
      if (label === 'banned') {
        expect(await reload(moderated.id)).toEqual(moderated);
      } else {
        expect((await reload(moderated.id)).hidden).toBe(true);
      }
    },
  );
});
