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
import { eq, sql, type SQL } from 'drizzle-orm';
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
  type DiscoveryResult,
} from './steam-itad-discovery.helpers';
import {
  findModeratedMatch,
  lockModerationKeys,
} from '../igdb/games-moderation-match.helpers';
import type { IgdbApiGame } from '../igdb/igdb.constants';
import { upsertItadGame } from '../igdb/igdb-itad-upsert.helpers';
import { mapDbRowToDetail } from '../igdb/igdb.mappers';

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

  it('a second Steam app mapping to a hidden game slug 404s and creates no visible twin', async () => {
    await insertGame({
      slug: 'rok1843-twin',
      name: 'Rok1843 Twin',
      steamAppId: 184304,
      hidden: true,
    });
    jest
      .spyOn(testApp.app.get(ItadService), 'lookupBySteamAppId')
      .mockResolvedValue(itadGame('rok1843-twin', 'Rok1843 Twin'));

    const res = await testApp.request.get('/games/by-steam-id/184305');

    expect(res.status).toBe(404);
    const rows = await testApp.db
      .select({ hidden: schema.games.hidden })
      .from(schema.games)
      .where(eq(schema.games.name, 'Rok1843 Twin'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.hidden)).toBe(true);
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

describe('ROK-1843 a merge never moves a hidden row off its Steam app id', () => {
  it('a name merge from another Steam app keeps the hidden row anchored', async () => {
    const hidden = await insertGame({
      slug: 'rok1843-anchor',
      name: 'Rok1843 Anchor',
      steamAppId: 184331,
      steamAppIdSource: 'steam',
      hidden: true,
    });

    await discoverGameViaItad(
      184332,
      syncDeps(itadGame('rok1843-anchor-itad', 'Rok1843 Anchor')),
      'itad',
    );

    const after = await reload(hidden.id);
    expect(after.steamAppId).toBe(184331);
    expect(after.steamAppIdSource).toBe('steam');
    expect(after.hidden).toBe(true);
  });

  it('a hidden row with no Steam app id takes the incoming one', async () => {
    const hidden = await insertGame({
      slug: 'rok1843-anchor-null',
      name: 'Rok1843 Anchor Null',
      hidden: true,
    });

    await discoverGameViaItad(
      184333,
      syncDeps(itadGame('rok1843-anchor-null-itad', 'Rok1843 Anchor Null')),
      'itad',
    );

    const after = await reload(hidden.id);
    expect(after.steamAppId).toBe(184333);
    expect(after.steamAppIdSource).toBe('itad');
  });
});

describe('ROK-1843 ITAD search never returns or rewrites a moderated row', () => {
  function stubSearch(game: ItadGame, steamAppId: number): jest.SpyInstance {
    const itad = testApp.app.get(ItadService);
    const igdb = testApp.app.get(IgdbService);
    const searchSpy = jest.spyOn(itad, 'searchGames').mockResolvedValue([game]);
    jest.spyOn(itad, 'getGameInfo').mockResolvedValue(null);
    jest
      .spyOn(itad, 'lookupSteamAppIds')
      .mockResolvedValue(new Map([[game.id, steamAppId]]));
    jest.spyOn(igdb, 'queryIgdb').mockResolvedValue([]);
    jest.spyOn(igdb, 'isAdultFilterEnabled').mockResolvedValue(false);
    return searchSpy;
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
      const searchSpy = stubSearch(
        itadGame(`rok1843-zq-${label}`, `Rok1843 Zq ${label}`),
        appId,
      );

      const res = await testApp.request.get(
        `/games/search?q=rok1843 zq ${label}`,
      );

      expect(res.status).toBe(200);
      // The ITAD layer swallows errors and falls back — prove it really ran.
      expect(searchSpy).toHaveBeenCalled();
      const ids = (res.body.data as { id: number }[]).map((g) => g.id);
      expect(ids).not.toContain(moderated.id);
      // Hidden rows are read-only to discovery too (Codex r1 P2).
      expect(await reload(moderated.id)).toEqual(moderated);
    },
  );
});

describe('ROK-1843 Codex r1: one moderation lookup on every path', () => {
  it('a banned itadGameId is not recreated as a visible slug twin', async () => {
    await insertGame({
      slug: 'rok1843-twin',
      name: 'Rok1843 Twin',
      steamAppId: 184341,
    });
    const banned = await insertGame({
      slug: 'rok1843-twin-banned',
      name: 'Rok1843 Twin Banned Original',
      itadGameId: 'itad-rok1843-twin',
      banned: true,
    });

    const result = await discoverGameViaItad(
      184342,
      syncDeps(itadGame('rok1843-twin', 'Rok1843 Twin', 'itad-rok1843-twin')),
      'steam',
    );

    expect(result).toBeNull();
    const twins = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.steamAppId, 184342));
    expect(twins).toEqual([]);
    expect(await reload(banned.id)).toEqual(banned);
  });

  it.each([
    ['itadGameId', { itadGameId: 'itad-rok1843-alt' }],
    ['steamAppId', { steamAppId: 184343 }],
    ['normalized name', { name: 'Rok1843 Alt Key II' }],
  ])(
    'the failed-upsert fallback lookup flags a banned row matched by %s',
    async (_label, key) => {
      const banned = await insertGame({
        slug: 'rok1843-alt-banned',
        name: 'Rok1843 Alt Banned',
        banned: true,
        ...key,
      });

      const match = await findModeratedMatch(testApp.db, {
        slug: 'rok1843-alt-incoming',
        itadGameId: 'itad-rok1843-alt',
        steamAppId: 184343,
        name: 'Rok1843 Alt Key 2',
      });

      expect(match).toEqual({ id: banned.id, hidden: false, banned: true });
    },
  );

  it('a hidden alternate-key match is not rewritten by an anonymous search upsert', async () => {
    const hidden = await insertGame({
      slug: 'rok1843-alt-hidden',
      name: 'Rok1843 Alt Hidden',
      hidden: true,
    });
    // Matched by normalized name (the alt key the old update path used); the
    // search brings a new slug, a new itadGameId and fresh metadata.
    const incoming = {
      ...mapDbRowToDetail(hidden),
      slug: 'rok1843-alt-hidden-itad',
      itadGameId: 'itad-rok1843-alt-hidden-new',
      summary: 'rewritten by an anonymous search',
    };

    const returned = await upsertItadGame(testApp.db, incoming);

    expect(returned.id).toBe(hidden.id);
    expect(await reload(hidden.id)).toEqual(hidden);
  });

  it('a ban committed while discovery waits on the row is honoured', async () => {
    const row = await insertGame({
      slug: 'rok1843-race',
      name: 'Rok1843 Race',
    });
    let discovery: Promise<DiscoveryResult | null> | undefined;

    await testApp.db.transaction(async (tx) => {
      await tx
        .update(schema.games)
        .set({ banned: true })
        .where(eq(schema.games.id, row.id));
      discovery = discoverGameViaItad(
        184351,
        syncDeps(itadGame('rok1843-race', 'Rok1843 Race')),
        'steam',
      );
      await waitForBlockedBackend(tx);
    });

    if (!discovery) throw new Error('discovery never started');
    expect(await discovery).toBeNull();
    const after = await reload(row.id);
    expect(after.banned).toBe(true);
    expect(after.steamAppId).toBeNull();
  });
});

async function rowsWhere(where: SQL): Promise<GameRow[]> {
  return testApp.db.select().from(schema.games).where(where);
}

describe('ROK-1843 Codex r2: igdbId key and cross-name serialisation', () => {
  it('a row hidden by igdbId is not recreated as a visible twin', async () => {
    await insertGame({
      slug: 'rok1843-igdb-hidden',
      name: 'Rok1843 Igdb Hidden Original',
      igdbId: 184381,
      hidden: true,
    });
    const igdbHit: IgdbApiGame = {
      id: 184381,
      name: 'Rok1843 Igdb Other',
      slug: 'rok1843-igdb-other',
    };
    const deps: DiscoveryDeps = {
      ...syncDeps(itadGame('rok1843-igdb-itad', 'Rok1843 Igdb Other')),
      queryIgdb: jest.fn().mockResolvedValue([igdbHit]),
    };

    const result = await discoverGameViaItad(184382, deps, 'steam');

    expect(result?.hidden).toBe(true);
    const twins = await rowsWhere(eq(schema.games.steamAppId, 184382));
    expect(twins.every((r) => r.hidden)).toBe(true);
  });

  it('two discoveries with different names and one itadGameId leave no visible twin', async () => {
    let discovery: Promise<DiscoveryResult | null> | undefined;
    // An in-flight discovery for "Alpha": it holds the alternate-key lock and
    // has inserted its (adult-filtered, hidden) row but not yet committed.
    await testApp.db.transaction(async (tx) => {
      await lockModerationKeys(tx, { itadGameId: 'itad-rok1843-lock' });
      await tx.insert(schema.games).values({
        slug: 'rok1843-lock-alpha',
        name: 'Rok1843 Lock Alpha',
        itadGameId: 'itad-rok1843-lock',
        steamAppId: 184371,
        hidden: true,
      });
      discovery = discoverGameViaItad(
        184372,
        syncDeps(
          itadGame(
            'rok1843-lock-beta',
            'Rok1843 Lock Beta',
            'itad-rok1843-lock',
          ),
        ),
        'steam',
      );
      await waitForBlockedBackend(tx);
    });

    if (!discovery) throw new Error('discovery never started');
    expect((await discovery)?.hidden).toBe(true);
    const all = await rowsWhere(sql`${schema.games.name} LIKE 'Rok1843 Lock%'`);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((r) => r.hidden)).toBe(true);
  });
});

describe('ROK-1843 Codex r3: slug serialisation', () => {
  it('two discoveries with different names sharing only a slug leave no visible twin', async () => {
    let discovery: Promise<DiscoveryResult | null> | undefined;
    // An in-flight discovery for "Gamma" holds the slug lock and has inserted
    // its hidden row but not yet committed; "Delta" shares only the slug.
    await testApp.db.transaction(async (tx) => {
      await lockModerationKeys(tx, { slug: 'rok1843-slug-shared' });
      await tx.insert(schema.games).values({
        slug: 'rok1843-slug-shared',
        name: 'Rok1843 Slug Gamma',
        itadGameId: 'itad-rok1843-slug-gamma',
        steamAppId: 184373,
        hidden: true,
      });
      discovery = discoverGameViaItad(
        184374,
        syncDeps(
          itadGame(
            'rok1843-slug-shared',
            'Rok1843 Slug Delta',
            'itad-rok1843-slug-delta',
          ),
        ),
        'steam',
      );
      await waitForBlockedBackend(tx);
    });

    if (!discovery) throw new Error('discovery never started');
    expect((await discovery)?.hidden).toBe(true);
    const all = await rowsWhere(sql`${schema.games.name} LIKE 'Rok1843 Slug%'`);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((r) => r.hidden)).toBe(true);
  });
});

describe('ROK-1843 Codex r2: distinct editions', () => {
  it('a banned edition does not suppress a remake with a different igdbId', async () => {
    const banned = await insertGame({
      slug: 'rok1843-edition',
      name: 'Rok1843 Edition',
      igdbId: 184391,
      banned: true,
    });

    const remake = await findModeratedMatch(testApp.db, {
      slug: 'rok1843-edition-remake',
      name: 'Rok1843 Edition',
      igdbId: 184392,
    });
    const unknownEdition = await findModeratedMatch(testApp.db, {
      slug: 'rok1843-edition-unknown',
      name: 'Rok1843 Edition',
    });

    expect(remake).toBeNull();
    expect(unknownEdition).toEqual({
      id: banned.id,
      hidden: false,
      banned: true,
    });
  });
});

/**
 * Resolve once another backend is waiting on a row lock — i.e. discovery has
 * reached the locked row and is blocked behind the uncommitted ban.
 */
async function waitForBlockedBackend(
  tx: Parameters<Parameters<TestApp['db']['transaction']>[0]>[0],
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const rows = await tx.execute<{ waiting: number }>(
      sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('discovery never blocked on the banned row');
}
