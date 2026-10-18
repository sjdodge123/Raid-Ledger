import type { GuildSummary } from '@raid-ledger/contract';
import {
  buildServerHubPage,
  orderServerMembers,
  toServerMemberRow,
  type ServerMemberRecord,
} from './server-hub-page.helpers';

const rec = (o: Partial<ServerMemberRecord>): ServerMemberRecord => ({
  memberId: 1,
  userId: 1,
  name: 'a',
  steamId: null,
  source: 'presence',
  lastSeenAt: null,
  joinedAt: null,
  leftAt: null,
  characterName: null,
  ...o,
});

const guild: GuildSummary = {
  id: 7,
  gameId: 3,
  kind: 'game_server',
  name: 'Vale',
  region: 'server',
  realmSlug: null,
  realmName: null,
  faction: null,
  memberCount: 0,
  lastSnapshotAt: null,
};

describe('server hub page helpers (ROK-1831)', () => {
  it('orders online first, then last seen desc, never-seen last', () => {
    const rows = orderServerMembers([
      toServerMemberRow(rec({ name: 'never' }), false),
      toServerMemberRow(
        rec({ name: 'old', lastSeenAt: new Date('2026-01-01') }),
        false,
      ),
      toServerMemberRow(
        rec({ name: 'new', lastSeenAt: new Date('2026-10-01') }),
        false,
      ),
      toServerMemberRow(
        rec({ name: 'on', lastSeenAt: new Date('2025-01-01') }),
        true,
      ),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['on', 'new', 'old', 'never']);
  });

  it('builds one unranked group with online flags and viewerJoined', () => {
    const page = buildServerHubPage({
      guild,
      role: 'member',
      viewerId: 2,
      members: [
        rec({ memberId: 10, userId: 1, steamId: 's1' }),
        rec({
          memberId: 11,
          userId: 2,
          joinedAt: new Date(),
          source: 'manual',
        }),
      ],
      onlineSteamIds: new Set(['s1']),
      server: {
        pelicanServerId: 5,
        gameSlug: 'valheim',
        gameIconUrl: null,
        state: 'running',
      },
    });
    expect(page.ranks).toHaveLength(1);
    expect(page.ranks[0]?.members.map((m) => m.server?.onlineNow)).toEqual([
      true,
      false,
    ]);
    expect(page.server?.viewerJoined).toBe(true);
    expect(page.guild.memberCount).toBe(2);
    expect(page.viewer.role).toBe('member');
  });
});

describe('server hub page helpers — server block', () => {
  it('omits the server block when the server is gone', () => {
    const page = buildServerHubPage({
      guild,
      role: 'visitor',
      viewerId: 9,
      members: [],
      onlineSteamIds: new Set(),
      server: undefined,
    });
    expect(page.server).toBeUndefined();
  });
});
