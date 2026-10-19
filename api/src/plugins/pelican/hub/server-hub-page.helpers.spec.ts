import type { GuildSummary } from '@raid-ledger/contract';
import {
  buildServerHubPage,
  recentArrivals,
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
  firstSeenAt: null,
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

describe('server hub page helpers — recent arrivals (ROK-1831)', () => {
  it('fills firstSeenAt on the member row', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    const row = toServerMemberRow(rec({ firstSeenAt: at }), false);
    expect(row.server?.firstSeenAt).toBe(at.toISOString());
    expect(toServerMemberRow(rec({}), false).server?.firstSeenAt).toBeNull();
  });

  it('lists the newest five by first sighting, skipping never-seen', () => {
    const members = [0, 1, 2, 3, 4, 5].map((d) =>
      rec({
        memberId: d + 1,
        name: `m${d}`,
        firstSeenAt: new Date(Date.UTC(2026, 9, d + 1)),
        characterName: d === 5 ? 'Viking' : null,
      }),
    );
    members.push(rec({ memberId: 99, name: 'never' }));
    const out = recentArrivals(members);
    expect(out.map((a) => a.name)).toEqual(['m5', 'm4', 'm3', 'm2', 'm1']);
    expect(out[0]).toEqual({
      memberId: 6,
      name: 'm5',
      characterName: 'Viking',
      firstSeenAt: '2026-10-06T00:00:00.000Z',
    });
  });

  it('puts recentArrivals on the server block', () => {
    const page = buildServerHubPage({
      guild,
      role: 'member',
      viewerId: 9,
      members: [rec({ firstSeenAt: new Date('2026-10-01') })],
      onlineSteamIds: new Set(),
      server: {
        pelicanServerId: 5,
        gameSlug: 'valheim',
        gameIconUrl: null,
        state: 'running',
      },
    });
    expect(page.server?.recentArrivals).toHaveLength(1);
  });

  it('a presence-only member (never pressed Join) is viewerJoined', () => {
    const page = buildServerHubPage({
      guild,
      role: 'member',
      viewerId: 4,
      members: [rec({ userId: 4, lastSeenAt: new Date(), joinedAt: null })],
      onlineSteamIds: new Set(),
      server: {
        pelicanServerId: 5,
        gameSlug: 'valheim',
        gameIconUrl: null,
        state: 'running',
      },
    });
    expect(page.server?.viewerJoined).toBe(true);
  });

  it('a visitor sees the member count but no rows and no arrivals (members-first)', () => {
    const page = buildServerHubPage({
      guild,
      role: 'visitor',
      viewerId: 9,
      members: [rec({ firstSeenAt: new Date('2026-10-01') })],
      onlineSteamIds: new Set(),
      server: {
        pelicanServerId: 5,
        gameSlug: 'valheim',
        gameIconUrl: null,
        state: 'running',
      },
    });
    expect(page.guild.memberCount).toBe(1);
    expect(page.ranks[0]?.members).toEqual([]);
    expect(page.server?.recentArrivals).toBeUndefined();
    expect(page.server?.viewerJoined).toBe(false);
  });

  it('counts who is online for every viewer, visitors included (Codex r2 P3)', () => {
    const input = {
      guild,
      viewerId: 9,
      members: [
        rec({ memberId: 1, steamId: 's1' }),
        rec({ memberId: 2, steamId: 's2' }),
        rec({ memberId: 3, steamId: null }),
      ],
      onlineSteamIds: new Set(['s1', 's2', 'stranger']),
      server: {
        pelicanServerId: 5,
        gameSlug: 'valheim',
        gameIconUrl: null,
        state: 'running' as const,
      },
    };
    const visitor = buildServerHubPage({ ...input, role: 'visitor' });
    expect(visitor.ranks[0]?.members).toEqual([]);
    expect(visitor.server?.onlineCount).toBe(2);
    const member = buildServerHubPage({ ...input, role: 'member' });
    expect(member.server?.onlineCount).toBe(2);
  });
});
