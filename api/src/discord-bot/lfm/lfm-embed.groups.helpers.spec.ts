/**
 * ROK-2352 — the keyed (per-instance) board pass, with injected reads.
 *
 * The pass takes its three reads through `deps.reads`, so these tests hand it
 * fakes instead of spying on functions in the same module (a CJS spy cannot
 * intercept a module-internal call).
 */
import {
  LFG_BOARD_MAX_GROUP_POSTS_PER_GAME,
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

  it('does nothing for a game with no keyed rows and no adapter', async () => {
    const reads = fakeReads([], []);
    const t = harness(false, reads);
    await syncKeyedGroups(t.deps, game, true);
    expect(t.edits).toEqual([]);
    expect(t.posts).toEqual([]);
    expect(reads.listOpen).toHaveBeenCalledTimes(1);
  });
});
