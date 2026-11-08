/**
 * ROK-2120 — IGDB/ITAD sync writes must never violate a games unique key held
 * by an unmerged twin row, real DB.
 *
 * Prod: an IGDB-first row and an ITAD/Steam-first row of one title were never
 * merged. The refresh batch (refreshExistingGames → upsertGamesFromApi, ten
 * games in ONE transaction since ROK-1438) merged the IGDB game into the ITAD
 * copy by steamAppId and set an igdb_id the twin already held — the violation
 * rolled back the whole batch. Each case seeds that twin pair and asserts the
 * write is skipped + reported while every other write commits.
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { upsertGamesFromApi } from './igdb-upsert.helpers';
import { enrichSyncedGamesWithItad } from './igdb-sync.helpers';
import type { IgdbApiGame } from './igdb.constants';
import { nonEmpty } from '../common/testing/narrow';

const IGDB_OWNED = 9_212_001;
const IGDB_OTHER = 9_212_002;
const IGDB_NAMED = 9_212_003;
const STEAM_TWIN = 9_212_501;
const STEAM_ITAD = 9_212_601;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

async function seedGame(
  values: Partial<typeof schema.games.$inferInsert> & {
    name: string;
    slug: string;
  },
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values(values)
      .returning({ id: schema.games.id }),
    'seeded game',
  );
  return row.id;
}

async function readGame(id: number) {
  const [row] = nonEmpty(
    await testApp.db.select().from(schema.games).where(eq(schema.games.id, id)),
    'game row',
  );
  return row;
}

function igdbGame(
  id: number,
  name: string,
  slug: string,
  steamAppId: number | null = null,
): IgdbApiGame {
  return {
    id,
    name,
    slug,
    summary: `refreshed ${id}`,
    external_games:
      steamAppId == null ? [] : [{ category: 1, uid: String(steamAppId) }],
  };
}

describe('refresh batch with an unmerged IGDB/ITAD twin pair (ROK-2120)', () => {
  it('commits the other rows of the batch and reports the pair instead of violating games_igdb_id_unique', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const owner = await seedGame({
      name: 'ROK-2120 Twin Title',
      slug: 'rok-2120-twin-title',
      igdbId: IGDB_OWNED,
    });
    const itadCopy = await seedGame({
      name: 'ROK-2120 Twin Title (Steam)',
      slug: 'rok-2120-twin-title-steam',
      steamAppId: STEAM_TWIN,
    });
    const other = await seedGame({
      name: 'ROK-2120 Unrelated Game',
      slug: 'rok-2120-unrelated-game',
      igdbId: IGDB_OTHER,
    });

    await upsertGamesFromApi(testApp.db, [
      igdbGame(
        IGDB_OWNED,
        'ROK-2120 Twin Title',
        'rok-2120-twin-title',
        STEAM_TWIN,
      ),
      igdbGame(
        IGDB_OTHER,
        'ROK-2120 Unrelated Game',
        'rok-2120-unrelated-game',
      ),
    ]);

    expect((await readGame(other)).summary).toBe(`refreshed ${IGDB_OTHER}`);
    expect((await readGame(owner)).summary).toBe(`refreshed ${IGDB_OWNED}`);
    expect((await readGame(itadCopy)).igdbId).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      `IGDB duplicate pair skipped: keep=${owner} dup=${itadCopy} key=igdb_id`,
    );
  });

  it('names the real merge reason (normalized name) in the merge log', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    const target = await seedGame({
      name: 'ROK-2120 Name Match',
      slug: 'rok-2120-name-match-itad',
    });

    await upsertGamesFromApi(testApp.db, [
      igdbGame(IGDB_NAMED, 'ROK-2120 Name Match', 'rok-2120-name-match'),
    ]);

    const messages = log.mock.calls.map((c) => String(c[0]));
    expect(messages).toContain(
      `Merged IGDB ${IGDB_NAMED} into existing game ${target} by normalized name`,
    );
    expect(messages.filter((m) => m.includes('by steamAppId'))).toEqual([]);
  });
});

describe('ITAD enrichment with an itad_game_id held by a twin (ROK-2120)', () => {
  it('reports the pair and never violates games_itad_game_id_unique', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const holder = await seedGame({
      name: 'ROK-2120 Itad Holder',
      slug: 'rok-2120-itad-holder',
      itadGameId: 'rok-2120-itad-uuid',
    });
    const steamRow = await seedGame({
      name: 'ROK-2120 Itad Holder (Steam)',
      slug: 'rok-2120-itad-holder-steam',
      steamAppId: STEAM_ITAD,
    });

    const enriched = await enrichSyncedGamesWithItad(
      testApp.db,
      jest.fn().mockResolvedValue({
        id: 'rok-2120-itad-uuid',
        slug: 'rok-2120-itad-holder',
        title: 'ROK-2120 Itad Holder',
        type: 'game',
        mature: false,
      }),
      jest.fn().mockResolvedValue(null),
    );

    expect(enriched).toBe(0);
    expect((await readGame(steamRow)).itadGameId).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      `IGDB duplicate pair skipped: keep=${holder} dup=${steamRow} key=itad_game_id`,
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('ITAD enrichment failed'),
    );
  });
});
