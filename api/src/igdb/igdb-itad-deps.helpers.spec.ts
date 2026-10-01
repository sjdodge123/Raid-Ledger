/**
 * Tests for the ITAD search deps builder — banned/hidden lookup batching
 * (READLOGS:D2). The search pipeline used to issue one `games` SELECT per
 * result; it must issue exactly one for the whole result set.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameDetailDto } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type { ItadService } from '../itad/itad.service';
import { ITAD_INTERACTIVE_FETCH, type ItadGame } from '../itad/itad.constants';
import { buildItadSearchDeps } from './igdb-itad-deps.helpers';
import { executeItadSearch } from './igdb-itad-search.helpers';

function itadGame(slug: string): ItadGame {
  return {
    id: `uuid-${slug}`,
    slug,
    title: slug,
    type: 'game',
    mature: false,
    assets: {},
  };
}

/** Make the terminal of the SELECT chain resolve to `rows`. */
function resolveGamesSelect(db: MockDb, rows: { slug: string }[]): void {
  const thenable = () =>
    Object.assign(Promise.resolve(rows), {
      limit: jest.fn().mockResolvedValue(rows),
    });
  db.where.mockImplementation(thenable);
}

function mockItadService(slugs: string[]) {
  return {
    searchGames: jest.fn().mockResolvedValue(slugs.map(itadGame)),
    getGameInfo: jest.fn().mockResolvedValue(null),
    lookupSteamAppIds: jest.fn().mockResolvedValue(new Map()),
  };
}

function buildDeps(db: MockDb, slugs: string[], itad = mockItadService(slugs)) {
  const deps = buildItadSearchDeps({
    itadService: itad as unknown as ItadService,
    db: db as unknown as PostgresJsDatabase<typeof schema>,
    queryIgdb: jest.fn().mockResolvedValue([]),
    getAdultFilter: jest.fn().mockResolvedValue(false),
  });
  deps.upsertGame = (g: GameDetailDto) => Promise.resolve(g);
  return deps;
}

describe('buildItadSearchDeps — banned/hidden batching (READLOGS:D2)', () => {
  it('checks banned/hidden for N results with exactly one games query', async () => {
    const db = createDrizzleMock();
    resolveGamesSelect(db, []);
    const deps = buildDeps(db, ['game-a', 'game-b', 'game-c']);

    const result = await executeItadSearch(deps, 'game');

    expect(result.games).toHaveLength(3);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('skips the games query entirely when there are no results', async () => {
    const db = createDrizzleMock();
    resolveGamesSelect(db, []);
    const deps = buildDeps(db, []);

    await executeItadSearch(deps, 'nothing');

    expect(db.select).not.toHaveBeenCalled();
  });

  it('excludes every slug the batch query reports as banned or hidden', async () => {
    const db = createDrizzleMock();
    resolveGamesSelect(db, [{ slug: 'game-b' }]);
    const deps = buildDeps(db, ['game-a', 'game-b', 'game-c']);

    const result = await executeItadSearch(deps, 'game');

    expect(result.games.map((g) => g.slug)).toEqual(['game-a', 'game-c']);
  });
});

describe('buildItadSearchDeps — interactive fail-fast', () => {
  it('passes the interactive limit to every ITAD call a search makes', async () => {
    const db = createDrizzleMock();
    resolveGamesSelect(db, []);
    const itad = mockItadService(['game-a', 'game-b']);
    const deps = buildDeps(db, [], itad);

    await executeItadSearch(deps, 'game');

    expect(itad.searchGames).toHaveBeenCalledWith(
      'game',
      undefined,
      ITAD_INTERACTIVE_FETCH,
    );
    expect(itad.getGameInfo.mock.calls).toEqual([
      ['uuid-game-a', ITAD_INTERACTIVE_FETCH],
      ['uuid-game-b', ITAD_INTERACTIVE_FETCH],
    ]);
    expect(itad.lookupSteamAppIds).toHaveBeenCalledWith(
      [
        { id: 'uuid-game-a', slug: 'game-a' },
        { id: 'uuid-game-b', slug: 'game-b' },
      ],
      ITAD_INTERACTIVE_FETCH,
    );
  });
});
