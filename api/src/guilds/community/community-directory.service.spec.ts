import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildKind, HubDirectoryEntry } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import type { GuildAccessService } from '../guild-access.service';
import type { HubKindRegistry } from '../hub-kind.registry';
import type { HubKindAdapter } from '../../plugins/plugin-host/extension-points';
import { CommunityDirectoryService } from './community-directory.service';
import { listDirectory } from './community-directory.queries';
import {
  findGameName,
  listProposals,
  openProposalGameIds,
} from './community-proposals.queries';
import { loadDiscordFields } from './community-hub.reads';

jest.mock('./community-directory.queries', () => ({
  listDirectory: jest.fn(),
}));
jest.mock('./community-proposals.queries', () => ({
  findGameName: jest.fn(),
  listProposals: jest.fn(),
  openProposalGameIds: jest.fn(),
}));
jest.mock('./community-hub.reads', () => ({ loadDiscordFields: jest.fn() }));

/** ROK-1875 §4 — the service builds the per-viewer scope and the live kinds. */
const listMock = jest.mocked(listDirectory);
const PAGE = { items: [], nextCursor: null, total: 0 };
const QUERY = {
  membership: 'all',
  sort: 'members',
  limit: 24,
} as const;

/** A joined community hub row on game 42. */
function joinedEntry(id: number): HubDirectoryEntry {
  return {
    id,
    gameId: 42,
    gameName: 'Game',
    gameIconUrl: null,
    name: `Hub ${id}`,
    blurb: null,
    memberCount: 1,
    leaderName: null,
    viewer: 'member',
    kind: 'game_community',
  };
}

function build(live: GuildKind[], memberIds: number[]) {
  const adapters = live.map((kind) => ({ kind }) as HubKindAdapter);
  const registry = { active: () => adapters } as unknown as HubKindRegistry;
  const memberHubIds = jest.fn().mockResolvedValue(memberIds);
  const access = { memberHubIds } as unknown as GuildAccessService;
  const db = {} as PostgresJsDatabase<typeof schema>;
  return {
    service: new CommunityDirectoryService(db, registry, access),
    memberHubIds,
  };
}

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue(PAGE);
});

describe('CommunityDirectoryService.list', () => {
  it('scopes to every live kind and returns them in GUILD_KINDS order', async () => {
    const { service, memberHubIds } = build(
      ['game_community', 'game_server', 'wow_guild'],
      [4, 5],
    );
    const page = await service.list({ id: 9, role: 'member' }, QUERY);
    expect(memberHubIds).toHaveBeenCalledWith(9);
    expect(listMock).toHaveBeenCalledWith(expect.anything(), 9, QUERY, {
      kinds: ['wow_guild', 'game_server', 'game_community'],
      memberIds: [4, 5],
      staff: false,
    });
    expect(page.kinds).toEqual(['wow_guild', 'game_server', 'game_community']);
  });

  it('?kind= narrows the query but not the page kinds', async () => {
    const { service } = build(['game_community', 'game_server'], []);
    const query = { ...QUERY, kind: 'game_server' } as const;
    const page = await service.list({ id: 1, role: 'admin' }, query);
    const scope = listMock.mock.calls[0]?.[3];
    expect(scope).toEqual({
      kinds: ['game_server'],
      memberIds: [],
      staff: true,
    });
    expect(page.kinds).toEqual(['game_server', 'game_community']);
  });

  it('a kind whose plugin is inactive queries no kind at all', async () => {
    const { service } = build(['game_community'], []);
    await service.list(
      { id: 1, role: 'member' },
      { ...QUERY, kind: 'wow_guild' },
    );
    expect(listMock.mock.calls[0]?.[3]?.kinds).toEqual([]);
  });
});

describe('CommunityDirectoryService.byGame (ROK-1883)', () => {
  beforeEach(() => {
    jest.mocked(findGameName).mockResolvedValue('Game');
    jest.mocked(listProposals).mockResolvedValue([]);
    jest.mocked(openProposalGameIds).mockResolvedValue([]);
    jest.mocked(loadDiscordFields).mockResolvedValue(null);
  });

  it('lists every live kind with the viewer member ids, joined first', async () => {
    const { service, memberHubIds } = build(
      ['game_community', 'wow_guild', 'game_server'],
      [3],
    );
    await service.byGame({ id: 7, role: 'member' }, 42);
    expect(memberHubIds).toHaveBeenCalledWith(7);
    expect(listMock).toHaveBeenCalledWith(
      expect.anything(),
      7,
      { gameId: 42, membership: 'all', sort: 'members', limit: 50 },
      {
        kinds: ['wow_guild', 'game_server', 'game_community'],
        memberIds: [3],
        staff: false,
      },
      { joinedFirst: true },
    );
  });

  it('carries the full visible total past the 50-row cap (Codex P2)', async () => {
    const joined = Array.from({ length: 50 }, (_, i) => joinedEntry(i + 1));
    listMock.mockResolvedValue({ items: joined, nextCursor: 'more', total: 73 });
    const { service } = build(['game_community'], []);
    const res = await service.byGame({ id: 7, role: 'member' }, 42);
    expect(res.hubs).toHaveLength(50);
    expect(res.total).toBe(73);
  });

  it('a staff viewer gets the staff scope; a dead plugin kind is absent', async () => {
    const { service } = build(['game_community'], []);
    await service.byGame({ id: 1, role: 'operator' }, 42);
    expect(listMock.mock.calls[0]?.[3]).toEqual({
      kinds: ['game_community'],
      memberIds: [],
      staff: true,
    });
  });
});
