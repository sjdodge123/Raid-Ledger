/**
 * ROK-2352 — `GET /lfg/:gameId/groups` ordering: the whole-game `''` group
 * first, then the live groups busiest first; `include=catalogue` adds the
 * empty ones; a live key the adapter does not list is dropped; the fold is
 * just `''`. The SQL aggregates are mocked — their counts are the
 * integration spec's job.
 */
import type {
  LfgGroupDescriptor,
  LfgGroupingAdapter,
} from '../plugins/plugin-host/lfg-grouping.adapter';
import * as query from './lfg-query.helpers';
import type { LfgGameRef } from './lfg-group-scope.helpers';
import { readGroupList } from './lfg-group-list.helpers';

jest.mock('./lfg-query.helpers', () => ({
  ...jest.requireActual<typeof query>('./lfg-query.helpers'),
  getGroupSummary: jest.fn(),
}));

const mockedSummary = jest.mocked(query.getGroupSummary);

const GAME: LfgGameRef = {
  id: 7,
  name: 'World of Warcraft',
  slug: 'wow-classic',
  coverUrl: null,
  cooptimusOnlineMax: null,
};

const descriptor = (key: string, label: string): LfgGroupDescriptor => ({
  key,
  label,
  kind: key.startsWith('raid') ? 'raid' : 'dungeon',
  size: key.startsWith('raid') ? 40 : 5,
});
const CATALOGUE = [
  descriptor('dungeon:1', 'Deadmines'),
  descriptor('dungeon:2', 'Wailing Caverns'),
  descriptor('raid:3', 'Molten Core'),
];

function adapterListing(groups: LfgGroupDescriptor[]): LfgGroupingAdapter {
  return {
    behaviourId: 'test-lfg-grouping',
    listGroups: jest.fn().mockResolvedValue(groups),
    describeGroup: jest.fn(),
    saveHandDetail: jest.fn(),
    readMemberDetails: jest.fn(),
    buildLockInPatch: jest.fn(),
    buildCarryover: jest.fn(),
  };
}

/** One live aggregate row per `[groupKey, activeCount]`. */
function liveRow(groupKey: string, activeCount: number) {
  return {
    groupKey,
    gameId: GAME.id,
    gameName: GAME.name,
    gameSlug: GAME.slug,
    gameCoverUrl: null,
    viabilityThreshold: null,
    activeCount,
    soonestExpiresAt: null,
    hasOwnIntent: false,
    nowCount: 0,
    soonestNowExpiresAt: null,
  };
}

/** A db whose one grouped select resolves to `rows`. */
function dbReturning(rows: ReturnType<typeof liveRow>[]): query.LfgDb {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    groupBy: () => Promise.resolve(rows),
  };
  const db = { select: jest.fn(() => chain) };
  return db as unknown as query.LfgDb;
}

const keys = (r: { groups: { groupKey?: string | undefined }[] }): string[] =>
  r.groups.map((g) => g.groupKey ?? '<no key>');

beforeEach(() => {
  mockedSummary.mockReset();
  mockedSummary.mockImplementation((_db, game) =>
    Promise.resolve(
      query.toGroupSummary({ ...liveRow('', 3), gameId: game.id }),
    ),
  );
});

describe('readGroupList', () => {
  it('puts "" first, then live groups busiest first', async () => {
    const db = dbReturning([liveRow('dungeon:1', 2), liveRow('raid:3', 5)]);
    const res = await readGroupList(
      db,
      GAME,
      1,
      adapterListing(CATALOGUE),
      false,
    );
    expect(keys(res)).toEqual(['', 'raid:3', 'dungeon:1']);
    expect(res.groups[0]).toMatchObject({ kind: 'any', groupLabel: null });
    expect(res.groups[1]).toMatchObject({
      groupLabel: 'Molten Core',
      size: 40,
    });
  });

  it('include=catalogue adds the empty groups after the live ones', async () => {
    const db = dbReturning([liveRow('dungeon:2', 1)]);
    const res = await readGroupList(
      db,
      GAME,
      1,
      adapterListing(CATALOGUE),
      true,
    );
    expect(keys(res)).toEqual(['', 'dungeon:2', 'dungeon:1', 'raid:3']);
    expect(res.groups[2]).toMatchObject({ activeCount: 0, state: null });
  });

  it('drops a live key the adapter does not list', async () => {
    const db = dbReturning([liveRow('dungeon:99', 4), liveRow('dungeon:1', 1)]);
    const res = await readGroupList(
      db,
      GAME,
      1,
      adapterListing(CATALOGUE),
      false,
    );
    expect(keys(res)).toEqual(['', 'dungeon:1']);
  });

  it('folds to just "" over the whole game without an adapter', async () => {
    const db = dbReturning([liveRow('dungeon:1', 2)]);
    const res = await readGroupList(db, GAME, 1, null, true);
    expect(keys(res)).toEqual(['']);
    expect(mockedSummary).toHaveBeenCalledWith(db, GAME, 1, null);
  });

  it('a grouped game reads the "" summary scoped to ""', async () => {
    const db = dbReturning([]);
    await readGroupList(db, GAME, 1, adapterListing(CATALOGUE), false);
    expect(mockedSummary).toHaveBeenCalledWith(db, GAME, 1, '');
  });
});
