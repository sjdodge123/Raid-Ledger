/**
 * ROK-1925 — the roster-refs helper picks its loader by hub kind: guild roster
 * rows keyed `m<memberId>`, community characters keyed `c<characterId>` with
 * no member id, and no roster for any other kind.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../../drizzle/schema';
import type { HubKindAdapter } from '../../../plugin-host/extension-points';
import { loadRosterRows, type RawRosterRow } from '../guild-roster.helpers';
import { loadCommunityRosterRows } from './roster-insights.community';
import { emptyInsights, loadInsightRawRows } from './roster-insights.refs';

jest.mock('../guild-roster.helpers', () => ({
  ...jest.requireActual<object>('../guild-roster.helpers'),
  loadRosterRows: jest.fn(),
}));
jest.mock('./roster-insights.community', () => ({
  loadCommunityRosterRows: jest.fn(),
}));

const db = {} as unknown as PostgresJsDatabase<typeof schema>;
const guildRows = jest.mocked(loadRosterRows);
const communityRows = jest.mocked(loadCommunityRosterRows);

type Adapter = Pick<HubKindAdapter, 'kind' | 'memberUserIds'>;
const adapter = (kind: Adapter['kind'], ids: number[] = []): Adapter => ({
  kind,
  memberUserIds: jest.fn().mockResolvedValue(ids),
});

const rosterRow = (memberId: number, isMain: boolean): RawRosterRow => ({
  memberId,
  name: `M${memberId}`,
  class: null,
  level: null,
  rankIndex: 1,
  rankName: null,
  characterId: `ch-${memberId}-${String(isMain)}`,
  userId: 7,
  role: null,
  roleOverride: null,
  isMain,
  onlineAtExport: true,
  lastOnlineDays: null,
});

beforeEach(() => jest.clearAllMocks());

describe('loadInsightRawRows', () => {
  it('wow_guild: one row per member, keyed m<memberId>', async () => {
    guildRows.mockResolvedValue([rosterRow(3, false), rosterRow(3, true)]);
    const rows = await loadInsightRawRows(db, adapter('wow_guild'), 9);
    expect(guildRows).toHaveBeenCalledWith(db, 9);
    expect(communityRows).not.toHaveBeenCalled();
    expect(rows).toEqual([
      expect.objectContaining({
        key: 'm3',
        memberId: 3,
        characterId: 'ch-3-true',
        rankIndex: 1,
        onlineAtExport: true,
      }),
    ]);
  });

  it("game_community: the live members' characters, keyed c<characterId>", async () => {
    communityRows.mockResolvedValue([
      { characterId: 'abc', name: 'Ash', userId: 4, isMain: true },
    ]);
    const a = adapter('game_community', [4, 5]);
    const rows = await loadInsightRawRows(db, a, 12);
    expect(a.memberUserIds).toHaveBeenCalledWith(12);
    expect(communityRows).toHaveBeenCalledWith(db, 12, [4, 5]);
    expect(guildRows).not.toHaveBeenCalled();
    expect(rows).toEqual([
      {
        key: 'cabc',
        memberId: null,
        name: 'Ash',
        characterId: 'abc',
        userId: 4,
        isMain: true,
        rankIndex: null,
        onlineAtExport: null,
        lastOnlineDays: null,
      },
    ]);
  });

  it.each([
    ['another kind', adapter('game_server')],
    ['no live adapter', undefined],
  ])('%s: no roster', async (_case, a) => {
    expect(await loadInsightRawRows(db, a, 1)).toEqual([]);
    expect(guildRows).not.toHaveBeenCalled();
    expect(communityRows).not.toHaveBeenCalled();
  });
});

describe('emptyInsights', () => {
  it('names nobody and carries no members-only key', () => {
    const dto = emptyInsights();
    expect(dto.classes).toEqual([]);
    expect(Object.keys(dto).sort()).toEqual([
      'classes',
      'freshness',
      'levels',
      'roles',
    ]);
  });
});
