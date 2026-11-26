/**
 * ROK-2352 — the keyed (per-instance) board pass, with injected reads.
 *
 * The pass takes its three reads through `deps.reads`, so these tests hand it
 * fakes instead of spying on functions in the same module (a CJS spy cannot
 * intercept a module-internal call).
 */
import {
  createKeyedPostBudget,
  LFG_BOARD_MAX_GROUP_POSTS_PER_GAME,
  LFG_BOARD_NEW_GROUP_POSTS_PER_WINDOW,
  LFG_BOARD_NEW_GROUP_POSTS_WINDOW_MS,
  syncKeyedGroups,
  type LfmKeyedReads,
  type LfmKeyedSyncDeps,
} from './lfm-embed.groups.helpers';
import type { LfmGameRow, LfmMessageRow } from './lfm-embed.db-helpers';
import type { LfmGroupView } from './lfm-embed.helpers';

const game = { id: 7, name: 'WoW', slug: 'wow-classic' } as LfmGameRow;
const row = (groupKey: string, lastMemberCount = 3): LfmMessageRow =>
  ({
    id: `r-${groupKey}`,
    gameId: 7,
    groupKey,
    postKind: 'forum',
    lastMemberCount,
  }) as LfmMessageRow;

const LABELS: Record<string, string> = {
  'dungeon:36': 'Deadmines',
  'dungeon:389': 'Ragefire',
};

function registry(active: boolean) {
  const adapter = {
    describeGroup: jest.fn((_ctx: unknown, key: string) =>
      Promise.resolve(
        LABELS[key] === undefined
          ? null
          : { key, label: LABELS[key], kind: 'dungeon', size: 5 },
      ),
    ),
  };
  return { getAdapter: jest.fn(() => (active ? adapter : undefined)) };
}

function fakeReads(
  open: LfmMessageRow[],
  counts: Array<[string, number]>,
): LfmKeyedReads {
  return {
    listOpen: jest.fn(() => Promise.resolve(open)),
    countHands: jest.fn(() => Promise.resolve(new Map(counts))),
    liveView: jest.fn((_db, g: LfmGameRow, scope: string) =>
      Promise.resolve({
        state: 'open',
        gameId: g.id,
        gameName: g.name,
        gameSlug: g.slug,
        memberCount: new Map(counts).get(scope) ?? 0,
      } as LfmGroupView),
    ),
  };
}

function harness(active: boolean, reads: LfmKeyedReads) {
  const edits: Array<[LfmMessageRow, LfmGroupView]> = [];
  const posts: LfmGroupView[] = [];
  const deps: LfmKeyedSyncDeps = {
    db: {} as never,
    registry: registry(active) as never,
    reads,
    edit: (r, v) => {
      edits.push([r, v]);
      return Promise.resolve();
    },
    post: (v) => {
      posts.push(v);
      return Promise.resolve();
    },
  };
  return { deps, edits, posts };
}

describe('syncKeyedGroups — new posts', () => {
  it('posts a keyed group at LFM titled "<game> — <instance>" with its key', async () => {
    const reads = fakeReads(
      [],
      [
        ['dungeon:36', 2],
        ['dungeon:389', 1],
      ],
    );
    const t = harness(true, reads);
    await syncKeyedGroups(t.deps, game, true);
    expect(t.posts.map((v) => [v.gameName, v.groupKey, v.memberCount])).toEqual(
      [['WoW — Deadmines', 'dungeon:36', 2]],
    );
    expect(reads.liveView).toHaveBeenCalledWith(t.deps.db, game, 'dungeon:36');
  });

  it('titles an unknown key with the bare game name', async () => {
    const t = harness(true, fakeReads([], [['raid:999', 3]]));
    await syncKeyedGroups(t.deps, game, true);
    expect(t.posts.map((v) => [v.gameName, v.groupKey])).toEqual([
      ['WoW', 'raid:999'],
    ]);
  });
});

describe('syncKeyedGroups — open keyed rows', () => {
  it('never posts for a hidden game but still edits open keyed rows', async () => {
    const t = harness(
      true,
      fakeReads(
        [row('dungeon:36')],
        [
          ['dungeon:36', 2],
          ['dungeon:389', 4],
        ],
      ),
    );
    await syncKeyedGroups(t.deps, game, false);
    expect(t.posts).toEqual([]);
    expect(t.edits.map(([r, v]) => [r.id, v.state, v.gameName])).toEqual([
      ['r-dungeon:36', 'open', 'WoW — Deadmines'],
    ]);
  });

  it('ends an open keyed row whose group fell below its floor', async () => {
    const t = harness(true, fakeReads([row('dungeon:36', 4)], []));
    await syncKeyedGroups(t.deps, game, true);
    expect(
      t.edits.map(([, v]) => [v.state, v.groupKey, v.memberCount, v.gameName]),
    ).toEqual([['expired', 'dungeon:36', 4, 'WoW — Deadmines']]);
    expect(t.posts).toEqual([]);
  });

  it('ends every open keyed row when the adapter is inactive (fold), reading no counts', async () => {
    const reads = fakeReads([row('dungeon:36', 3)], [['dungeon:389', 5]]);
    const t = harness(false, reads);
    await syncKeyedGroups(t.deps, game, true);
    expect(
      t.edits.map(([, v]) => [v.state, v.groupKey, v.memberCount]),
    ).toEqual([['expired', 'dungeon:36', 3]]);
    expect(t.posts).toEqual([]);
    expect(reads.countHands).not.toHaveBeenCalled();
  });
});

describe('syncKeyedGroups — cap and no-op', () => {
  it('holds the per-game cap of open keyed posts', async () => {
    expect(LFG_BOARD_MAX_GROUP_POSTS_PER_GAME).toBe(4);
    const open = ['a:1', 'a:2', 'a:3'].map((k) => row(k));
    const t = harness(
      true,
      fakeReads(open, [
        ['a:1', 2],
        ['a:2', 2],
        ['a:3', 2],
        ['b:1', 2],
        ['b:2', 2],
      ]),
    );
    await syncKeyedGroups(t.deps, game, true);
    expect(t.posts.map((v) => v.groupKey)).toEqual(['b:1']);
    expect(t.edits).toHaveLength(3);
  });

  it("returns the groups the cap refused, titled by instance, for the '' line", async () => {
    const open = ['a:1', 'a:2', 'a:3'].map((k) => row(k));
    const t = harness(
      true,
      fakeReads(open, [
        ['a:1', 2],
        ['a:2', 2],
        ['a:3', 2],
        ['b:1', 2],
        ['dungeon:36', 3],
        ['dungeon:389', 4],
        ['c:1', 1],
      ]),
    );
    const overflow = await syncKeyedGroups(t.deps, game, true);
    expect(t.posts.map((v) => v.groupKey)).toEqual(['b:1']);
    expect(overflow).toEqual([
      { label: 'Deadmines', count: 3 },
      { label: 'Ragefire', count: 4 },
    ]);
  });

  it('returns no overflow under the cap, with no adapter, or for a hidden game', async () => {
    const counts: Array<[string, number]> = [['dungeon:36', 2]];
    const under = harness(true, fakeReads([], counts));
    expect(await syncKeyedGroups(under.deps, game, true)).toEqual([]);
    const off = harness(false, fakeReads([], counts));
    expect(await syncKeyedGroups(off.deps, game, true)).toEqual([]);
    const full = ['a:1', 'a:2', 'a:3', 'a:4'].map((k) => row(k));
    const hidden = harness(true, fakeReads(full, counts));
    expect(await syncKeyedGroups(hidden.deps, game, false)).toEqual([]);
  });

  it('does nothing for a game with no keyed rows and no adapter', async () => {
    const reads = fakeReads([], []);
    const t = harness(false, reads);
    await syncKeyedGroups(t.deps, game, true);
    expect(t.edits).toEqual([]);
    expect(t.posts).toEqual([]);
    expect(reads.listOpen).toHaveBeenCalledTimes(1);
  });
});

describe('syncKeyedGroups — new-post ration (Q11: 3 per game per 10 min)', () => {
  const NOW = new Date('2026-11-25T12:00:00Z');
  const keys = ['a:1', 'a:2', 'a:3', 'a:4'];

  it('posts at most three new keyed groups per window, keyed by game id', async () => {
    expect(LFG_BOARD_NEW_GROUP_POSTS_PER_WINDOW).toBe(3);
    expect(LFG_BOARD_NEW_GROUP_POSTS_WINDOW_MS).toBe(600_000);
    const budget = createKeyedPostBudget();
    const spend = jest.spyOn(budget, 'trySpend');
    const t = harness(
      true,
      fakeReads(
        [],
        keys.map((k) => [k, 2]),
      ),
    );
    t.deps.postBudget = budget;
    await syncKeyedGroups(t.deps, game, true, NOW);
    expect(t.posts.map((v) => v.groupKey)).toEqual(['a:1', 'a:2', 'a:3']);
    expect(spend).toHaveBeenLastCalledWith('7', NOW.getTime());
  });

  it('posts the waiting group on a later pass once the window has rolled', async () => {
    const budget = createKeyedPostBudget();
    const first = harness(
      true,
      fakeReads(
        [],
        keys.map((k) => [k, 2]),
      ),
    );
    first.deps.postBudget = budget;
    await syncKeyedGroups(first.deps, game, true, NOW);
    const open = ['a:1', 'a:2', 'a:3'].map((k) => row(k));
    const soon = harness(
      true,
      fakeReads(
        open,
        keys.map((k) => [k, 2]),
      ),
    );
    soon.deps.postBudget = budget;
    await syncKeyedGroups(
      soon.deps,
      game,
      true,
      new Date(NOW.getTime() + 60_000),
    );
    expect(soon.posts).toEqual([]);
    const later = harness(
      true,
      fakeReads(
        open,
        keys.map((k) => [k, 2]),
      ),
    );
    later.deps.postBudget = budget;
    const rolled = new Date(
      NOW.getTime() + LFG_BOARD_NEW_GROUP_POSTS_WINDOW_MS,
    );
    await syncKeyedGroups(later.deps, game, true, rolled);
    expect(later.posts.map((v) => v.groupKey)).toEqual(['a:4']);
  });

  it('a spent budget still edits the open keyed rows', async () => {
    const t = harness(
      true,
      fakeReads(
        [row('a:1')],
        [
          ['a:1', 2],
          ['a:2', 2],
        ],
      ),
    );
    t.deps.postBudget = { trySpend: () => false };
    await syncKeyedGroups(t.deps, game, true, NOW);
    expect(t.posts).toEqual([]);
    expect(t.edits.map(([r, v]) => [r.id, v.state])).toEqual([
      ['r-a:1', 'open'],
    ]);
  });

  it("another game's posts do not spend this game's budget", async () => {
    const budget = createKeyedPostBudget();
    for (let i = 0; i < 3; i += 1) budget.trySpend('8', NOW.getTime());
    const t = harness(true, fakeReads([], [['a:1', 2]]));
    t.deps.postBudget = budget;
    await syncKeyedGroups(t.deps, game, true, NOW);
    expect(t.posts.map((v) => v.groupKey)).toEqual(['a:1']);
  });
});

describe('syncKeyedGroups — keyed endings (ROK-2352 P1-5 / P2-1)', () => {
  const view = (state: LfmGroupView['state'], tag: string): LfmGroupView =>
    ({ state, gameId: 7, gameName: tag, memberCount: 2 }) as LfmGroupView;

  function run(
    reads: LfmKeyedReads,
    change?: LfmKeyedSyncDeps['change'],
  ): Promise<Array<[LfmMessageRow, LfmGroupView]>> {
    const edits: Array<[LfmMessageRow, LfmGroupView]> = [];
    const deps: LfmKeyedSyncDeps = {
      db: {} as never,
      registry: registry(true) as never,
      reads,
      edit: (r, v) => {
        edits.push([r, v]);
        return Promise.resolve();
      },
      post: () => Promise.resolve(),
      ...(change ? { change } : {}),
    };
    return syncKeyedGroups(deps, game, true).then(() => edits);
  }

  it("renders a keyed lock-in's SCHEDULED view on that group's post only", async () => {
    const reads: LfmKeyedReads = {
      ...fakeReads(
        [row('dungeon:36'), row('dungeon:389')],
        [['dungeon:389', 2]],
      ),
      changeView: jest.fn(() => Promise.resolve(view('scheduled', 'event'))),
    };

    const edits = await run(reads, {
      gameId: 7,
      reason: 'converted',
      eventId: 99,
      groupKey: 'dungeon:36',
    });

    const states = edits.map(([r, v]) => [r.groupKey, v.state, v.gameName]);
    expect(states).toEqual([
      ['dungeon:36', 'scheduled', 'WoW — Deadmines'],
      ['dungeon:389', 'open', 'WoW — Ragefire'],
    ]);
  });

  it('ends a below-floor keyed post through provenance (SCHEDULED), not EXPIRED', async () => {
    const reads: LfmKeyedReads = {
      ...fakeReads([row('dungeon:36')], []),
      ended: jest.fn(() => Promise.resolve(view('scheduled', 'event'))),
    };

    const edits = await run(reads);

    expect(edits.map(([, v]) => v.state)).toEqual(['scheduled']);
    expect(reads.ended).toHaveBeenCalledWith({}, game, row('dungeon:36'));
  });

  it("keeps a keyed post PLAYING while its group's own session is open", async () => {
    const reads: LfmKeyedReads = {
      ...fakeReads([row('dungeon:36')], [['dungeon:36', 1]]),
      groupSession: jest.fn(() => Promise.resolve(view('playing', 'session'))),
    };

    const edits = await run(reads);

    expect(edits.map(([, v]) => v.state)).toEqual(['playing']);
    expect(reads.groupSession).toHaveBeenCalledWith({}, game, 'dungeon:36');
  });
});
