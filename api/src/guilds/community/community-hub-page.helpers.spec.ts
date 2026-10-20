/** ROK-1870 L2a — the pure `game_community` page builder (D4, D7, A2). */
import type { GuildSummary } from '@raid-ledger/contract';
import {
  buildCommunityHubPage,
  type CommunityHubPageInput,
  type CommunityMemberRecord,
} from './community-hub-page.helpers';

const guild: GuildSummary = {
  id: 7,
  gameId: 3,
  kind: 'game_community',
  name: 'BG3 Crew',
  region: 'community',
  realmSlug: null,
  realmName: null,
  faction: null,
  memberCount: 99,
  lastSnapshotAt: null,
};

function rec(over: Partial<CommunityMemberRecord>): CommunityMemberRecord {
  return {
    memberId: 1,
    userId: 1,
    role: 'member',
    joinedAt: new Date('2026-10-01T00:00:00Z'),
    leftAt: null,
    bannedAt: null,
    username: 'u',
    displayName: null,
    avatar: null,
    deactivatedAt: null,
    ...over,
  };
}

function input(over: Partial<CommunityHubPageInput>): CommunityHubPageInput {
  return {
    guild,
    status: 'active',
    blurb: 'Weekly co-op',
    role: 'member',
    viewerId: 2,
    viewerMayJoin: true,
    members: [
      rec({
        memberId: 10,
        userId: 1,
        role: 'leader',
        username: 'zed',
        avatar: 'https://img.example/a.png',
      }),
      rec({ memberId: 11, userId: 2, role: 'member', username: 'amy' }),
      rec({ memberId: 12, userId: 3, role: 'officer', username: 'bob' }),
      rec({ memberId: 13, userId: 4, leftAt: new Date(), username: 'gone' }),
      rec({
        memberId: 14,
        userId: 5,
        bannedAt: new Date(),
        leftAt: new Date(),
        username: 'bad',
      }),
    ],
    ...over,
  };
}

describe('ROK-1870 buildCommunityHubPage', () => {
  it('lists live members leader → officer → member and counts only them', () => {
    const page = buildCommunityHubPage(input({}));
    expect(page.ranks[0]?.members.map((r) => r.name)).toEqual([
      'zed',
      'bob',
      'amy',
    ]);
    expect(page.guild.memberCount).toBe(3);
    expect(page.guild.status).toBe('active');
    expect(page.guild.blurb).toBe('Weekly co-op');
  });

  it('gives a visitor the count and the community block but no rows', () => {
    const page = buildCommunityHubPage(
      input({ role: 'visitor', viewerId: 99 }),
    );
    expect(page.ranks[0]?.members).toEqual([]);
    expect(page.guild.memberCount).toBe(3);
    expect(page.community?.canJoin).toBe(true);
    expect(page.viewer.canEdit).toBe(false);
  });

  it('names the live leader with a public avatar url', () => {
    const page = buildCommunityHubPage(input({}));
    expect(page.community?.leader).toEqual({
      userId: 1,
      username: 'zed',
      avatarUrl: 'https://img.example/a.png',
    });
  });
});

describe('ROK-1870 community block — Join gating', () => {
  it('marks a live viewer joined (no Join)', () => {
    const c = buildCommunityHubPage(input({})).community;
    expect(c).toMatchObject({
      viewerJoined: true,
      viewerBanned: false,
      canJoin: false,
      joinBlockedReason: null,
    });
  });

  it('refuses Join to a banned viewer', () => {
    const c = buildCommunityHubPage(
      input({ role: 'visitor', viewerId: 5 }),
    ).community;
    expect(c).toMatchObject({
      viewerJoined: false,
      viewerBanned: true,
      canJoin: false,
      joinBlockedReason: 'banned',
    });
  });

  it('refuses Join outside the Discord guild (A2)', () => {
    const c = buildCommunityHubPage(
      input({ role: 'visitor', viewerId: 99, viewerMayJoin: false }),
    ).community;
    expect(c).toMatchObject({
      canJoin: false,
      joinBlockedReason: 'not-in-discord',
    });
  });

  it('refuses Join to an archived hub', () => {
    const c = buildCommunityHubPage(
      input({ role: 'visitor', viewerId: 4, status: 'archived' }),
    ).community;
    expect(c).toMatchObject({
      canJoin: false,
      joinBlockedReason: 'archived',
      status: 'archived',
    });
  });

  it('lets a left member re-Join', () => {
    const c = buildCommunityHubPage(
      input({ role: 'visitor', viewerId: 4 }),
    ).community;
    expect(c).toMatchObject({ viewerJoined: false, canJoin: true });
  });
});
