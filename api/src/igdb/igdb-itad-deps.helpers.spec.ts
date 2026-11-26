/**
 * Tests for the ITAD search deps builder — banned/hidden lookup batching
 * (READLOGS:D2). The search pipeline used to issue one `games` SELECT per
 * result; it must issue one per moderation phase (pre-upsert slugs,
 * post-upsert ids — ROK-1843) for the whole result set, independent of N.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameDetailDto } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type { ItadService } from '../itad/itad.service';
import { ITAD_INTERACTIVE_FETCH, type ItadGame } from '../itad/itad.constants';
import {
  buildItadSearchDeps,
  ITAD_INFO_CONCURRENCY,
  mapWithConcurrency,
} from './igdb-itad-deps.helpers';
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
  it('checks banned/hidden for N results with one batched query per phase', async () => {
    const db = createDrizzleMock();
    resolveGamesSelect(db, []);
    const deps = buildDeps(db, ['game-a', 'game-b', 'game-c']);

    const result = await executeItadSearch(deps, 'game');

    expect(result.games).toHaveLength(3);
    // Two queries for N results, never one per result: (1) the pre-upsert
    // slug batch (READLOGS:D2) and (2) the post-upsert by-id batch (ROK-1843),
    // which must run after the upsert because an alternate-key match can land
    // on a moderated row whose id is only known once the upsert returns.
    // The failed-upsert `hasModeratedMatch` lookup does not fire here.
    expect(db.select).toHaveBeenCalledTimes(2);
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

/** A fn whose calls stay in flight until released; tracks the peak. */
function gatedCalls<T>() {
  let inFlight = 0;
  let peak = 0;
  const waiters: (() => void)[] = [];
  const fn = (item: T): Promise<T> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    return new Promise<T>((resolve) => {
      waiters.push(() => {
        inFlight -= 1;
        resolve(item);
      });
    });
  };
  /** Release every waiting call, repeatedly, until the run settles. */
  async function drain(run: Promise<unknown>): Promise<void> {
    let done = false;
    void run.finally(() => (done = true));
    while (!done) {
      waiters.splice(0).forEach((release) => release());
      await new Promise((r) => setImmediate(r));
    }
  }
  return { fn, drain, peak: () => peak };
}

describe('ITAD getGameInfo fan-out cap (ROK-2325)', () => {
  it('mapWithConcurrency never exceeds the limit and keeps input order', async () => {
    const gate = gatedCalls<number>();
    const items = Array.from({ length: 11 }, (_, i) => i);
    const run = mapWithConcurrency(items, 3, gate.fn);
    await gate.drain(run);
    expect(gate.peak()).toBe(3);
    expect(await run).toEqual(items);
  });

  it('a search with 10 ITAD hits has at most ITAD_INFO_CONCURRENCY getGameInfo calls in flight', async () => {
    const gate = gatedCalls<string>();
    const slugs = Array.from({ length: 10 }, (_, i) => `cap-${i}`);
    const itad = mockItadService(slugs);
    itad.getGameInfo.mockImplementation(async (id: string) => {
      await gate.fn(id);
      return null;
    });
    const deps = buildDeps(createDrizzleMock(), slugs, itad);
    const run = deps.searchItad('cap');
    await gate.drain(run);
    expect(ITAD_INFO_CONCURRENCY).toBe(4);
    expect(gate.peak()).toBe(ITAD_INFO_CONCURRENCY);
    expect(itad.getGameInfo).toHaveBeenCalledTimes(10);
    expect((await run).map((g) => g.slug)).toEqual(slugs);
  });
});
