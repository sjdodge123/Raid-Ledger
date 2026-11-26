/**
 * ROK-2352 — the keyed (per-instance) board pass, with fake seams.
 */
import * as groups from './lfm-embed.groups.helpers';
import type { LfmGameRow, LfmMessageRow } from './lfm-embed.db-helpers';
import type { LfmGroupView } from './lfm-embed.helpers';
import * as views from './lfm-embed.views';

const game = { id: 7, name: 'WoW', slug: 'wow-classic' } as LfmGameRow;
const row = (groupKey: string, lastMemberCount = 3): LfmMessageRow =>
  ({
    id: `r-${groupKey}`,
    gameId: 7,
    groupKey,
    postKind: 'forum',
    lastMemberCount,
  }) as LfmMessageRow;

function adapterRegistry(active: boolean) {
  const adapter = {
    describeGroup: jest.fn((_ctx: unknown, key: string) =>
      Promise.resolve({
        key,
        label: key === 'dungeon:36' ? 'Deadmines' : 'Ragefire',
        kind: 'dungeon',
        size: 5,
      }),
    ),
  };
  return {
    registry: { getAdapter: jest.fn(() => (active ? adapter : undefined)) },
    adapter,
  };
}

function deps(active: boolean) {
  const { registry } = adapterRegistry(active);
  const edits: Array<[LfmMessageRow, LfmGroupView]> = [];
  const posts: LfmGroupView[] = [];
  return {
    edits,
    posts,
    deps: {
      db: {} as never,
      registry: registry as never,
      edit: (r: LfmMessageRow, v: LfmGroupView) => {
        edits.push([r, v]);
        return Promise.resolve();
      },
      post: (v: LfmGroupView) => {
        posts.push(v);
        return Promise.resolve();
      },
    },
  };
}

describe('syncKeyedGroups', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(views, 'liveView').mockImplementation((_db, g, scope) =>
      Promise.resolve({
        state: 'open',
        gameId: g.id,
        gameName: g.name,
        gameSlug: g.slug,
        memberCount: 2,
        ...(scope ? { groupKey: scope } : {}),
      }),
    );
  });

  it('posts a keyed group at LFM titled "<game> — <instance>" with its key', async () => {
    jest.spyOn(groups, 'listOpenKeyedLfmMessages').mockResolvedValue([]);
    jest.spyOn(groups, 'countLiveKeyedHands').mockResolvedValue(
      new Map([
        ['dungeon:36', 2],
        ['dungeon:389', 1],
      ]),
    );
    const t = deps(true);
    await groups.syncKeyedGroups(t.deps, game, true);
    expect(t.posts.map((v) => [v.gameName, v.groupKey])).toEqual([
      ['WoW — Deadmines', 'dungeon:36'],
    ]);
  });

  it('never posts for a hidden game but still edits open keyed rows', async () => {
    jest
      .spyOn(groups, 'listOpenKeyedLfmMessages')
      .mockResolvedValue([row('dungeon:36')]);
    jest.spyOn(groups, 'countLiveKeyedHands').mockResolvedValue(
      new Map([
        ['dungeon:36', 2],
        ['dungeon:389', 4],
      ]),
    );
    const t = deps(true);
    await groups.syncKeyedGroups(t.deps, game, false);
    expect(t.posts).toEqual([]);
    expect(t.edits.map(([, v]) => v.state)).toEqual(['open']);
  });

  it('ends every open keyed row when the adapter is inactive (fold)', async () => {
    jest
      .spyOn(groups, 'listOpenKeyedLfmMessages')
      .mockResolvedValue([row('dungeon:36', 3)]);
    const t = deps(false);
    await groups.syncKeyedGroups(t.deps, game, true);
    expect(
      t.edits.map(([, v]) => [v.state, v.groupKey, v.memberCount]),
    ).toEqual([['expired', 'dungeon:36', 3]]);
    expect(t.posts).toEqual([]);
  });

  it('holds the per-game cap of open keyed posts', async () => {
    const open = ['a:1', 'a:2', 'a:3'].map((k) => row(k));
    jest.spyOn(groups, 'listOpenKeyedLfmMessages').mockResolvedValue(open);
    jest.spyOn(groups, 'countLiveKeyedHands').mockResolvedValue(
      new Map([
        ['a:1', 2],
        ['a:2', 2],
        ['a:3', 2],
        ['b:1', 2],
        ['b:2', 2],
      ]),
    );
    const t = deps(true);
    await groups.syncKeyedGroups(t.deps, game, true);
    expect(t.posts.map((v) => v.groupKey)).toEqual(['b:1']);
  });
});
