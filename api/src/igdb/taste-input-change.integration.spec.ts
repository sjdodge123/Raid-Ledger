/**
 * ROK-2121: the 6-hourly IGDB + ITAD sync enqueues a game-taste recompute
 * only for games whose taste inputs (genres, game modes, themes, ITAD tags)
 * changed, and at most once per game per run.
 *
 * Drives the real `IgdbService.syncAllGames` against the test DB with the
 * IGDB and ITAD HTTP calls stubbed, and spies on
 * `GameTasteService.enqueueRecompute` (the production `onGameChanged` sink).
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { GameTasteService } from '../game-taste/game-taste.service';
import { ItadService } from '../itad/itad.service';
import type { ItadGame, ItadGameInfo } from '../itad/itad.constants';
import { IgdbService } from './igdb.service';
import type { IgdbApiGame } from './igdb.constants';
import { upsertGamesFromApi } from './igdb-upsert.helpers';

const GAME_A: IgdbApiGame = {
  id: 9300001,
  name: 'Taste Diff Alpha',
  slug: 'taste-diff-alpha',
  genres: [{ id: 12 }],
  themes: [{ id: 1 }],
  game_modes: [1, 2],
};
const GAME_B: IgdbApiGame = {
  id: 9300002,
  name: 'Taste Diff Bravo',
  slug: 'taste-diff-bravo',
  genres: [{ id: 5 }],
  themes: [{ id: 17 }],
  game_modes: [1],
};

function itadGame(appId: number): ItadGame {
  return {
    id: `itad-${appId}`,
    slug: `itad-${appId}`,
    title: `Itad ${appId}`,
    type: 'game',
    mature: false,
  };
}

function itadInfo(tags: string[]): ItadGameInfo {
  return { id: 'x', slug: 'x', title: 'x', type: 'game', mature: false, tags };
}

describe('IGDB sync taste-recompute gating (ROK-2121)', () => {
  let testApp: TestApp;
  let enqueueSpy: jest.SpyInstance;
  let queryIgdbSpy: jest.SpyInstance;
  let lookupSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(() => {
    enqueueSpy = jest
      .spyOn(testApp.app.get(GameTasteService), 'enqueueRecompute')
      .mockResolvedValue(undefined);
    const itad = testApp.app.get(ItadService);
    lookupSpy = jest
      .spyOn(itad, 'lookupBySteamAppId')
      .mockImplementation((appId: number) => Promise.resolve(itadGame(appId)));
    infoSpy = jest.spyOn(itad, 'getGameInfo');
    queryIgdbSpy = jest.spyOn(testApp.app.get(IgdbService), 'queryIgdb');
  });

  afterEach(async () => {
    for (const spy of [enqueueSpy, queryIgdbSpy, lookupSpy, infoSpy]) {
      spy.mockRestore();
    }
    testApp.seed = await truncateAllTables(testApp.db);
  });

  /** Store A and B exactly as IGDB serves them, plus Steam ids + ITAD tags. */
  async function seedStoredGames(): Promise<{ idA: number; idB: number }> {
    await upsertGamesFromApi(testApp.db, [GAME_A, GAME_B]);
    const ids: number[] = [];
    for (const [game, appId] of [
      [GAME_A, 930001],
      [GAME_B, 930002],
    ] as const) {
      const [row] = nonEmpty(
        await testApp.db
          .update(schema.games)
          .set({ steamAppId: appId, itadTags: ['RPG', 'Co-op'] })
          .where(eq(schema.games.igdbId, game.id))
          .returning({ id: schema.games.id }),
        `stored ${game.name}`,
      );
      ids.push(row.id);
    }
    const [idA, idB] = ids;
    if (idA === undefined || idB === undefined) throw new Error('seed failed');
    return { idA, idB };
  }

  it('AC1: a sync over unchanged IGDB + ITAD data enqueues no recompute', async () => {
    await seedStoredGames();
    queryIgdbSpy.mockResolvedValue([GAME_A, GAME_B]);
    // Same tags in another order and case: the vector lowercases + sorts.
    infoSpy.mockResolvedValue(itadInfo(['co-op', 'rpg']));

    await testApp.app.get(IgdbService).syncAllGames();

    expect(lookupSpy).toHaveBeenCalled();
    expect(enqueueSpy.mock.calls).toEqual([]);
  });

  /** Lowercased, sorted ITAD tags of a game as stored right now. */
  async function readItadTags(gameId: number): Promise<string[]> {
    const [row] = nonEmpty(
      await testApp.db
        .select({ itadTags: schema.games.itadTags })
        .from(schema.games)
        .where(eq(schema.games.id, gameId)),
      `game ${gameId}`,
    );
    const tags: unknown = row.itadTags;
    return Array.isArray(tags)
      ? tags.map((t) => String(t).toLowerCase()).sort()
      : [];
  }

  it('AC2: genres + ITAD tags changed in one run enqueue exactly one recompute for that game', async () => {
    const { idA } = await seedStoredGames();
    // Read the row the recompute would see at enqueue time (ordering, not count).
    const tagsAtEnqueue: string[][] = [];
    const reads: Promise<void>[] = [];
    enqueueSpy.mockImplementation((gameId: number) => {
      const read = readItadTags(gameId).then((tags) => {
        tagsAtEnqueue.push(tags);
      });
      reads.push(read);
      return read;
    });
    const changedA: IgdbApiGame = {
      ...GAME_A,
      genres: [{ id: 12 }, { id: 31 }],
    };
    queryIgdbSpy.mockResolvedValue([changedA, GAME_B]);
    infoSpy.mockImplementation((itadId: string) =>
      Promise.resolve(
        itadInfo(
          itadId === 'itad-930001'
            ? ['RPG', 'Co-op', 'Survival']
            : ['RPG', 'Co-op'],
        ),
      ),
    );

    await testApp.app.get(IgdbService).syncAllGames();

    await Promise.all(reads);
    // Refresh (genres) and ITAD (tags) both changed A; B changed nothing.
    expect(enqueueSpy.mock.calls).toEqual([[idA]]);
    // The one enqueue happened after ITAD wrote A's new tags.
    expect(tagsAtEnqueue).toEqual([['co-op', 'rpg', 'survival']]);
  });
});
