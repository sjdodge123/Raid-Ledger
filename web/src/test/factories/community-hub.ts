/**
 * ROK-1870 — factories for the community hub page payload (`GET /guilds/:id`
 * for `kind: 'game_community'`), shared by the L4/L5/L6 specs.
 */
import type { GuildMemberRow, GuildPage, GuildPageCommunity, LadderRole } from '@raid-ledger/contract';

/**
 * One community member row. `memberId` is the membership row id and is kept
 * DIFFERENT from `community.userId` (the id every `/hubs/:id/members/:userId`
 * route takes), so a spec that sends the wrong one fails.
 */
export function buildCommunityMember(userId: number, name: string, role: 'leader' | 'officer' | 'member'): GuildMemberRow {
    return {
        memberId: userId + 100, name, class: null, level: null, rankIndex: null, rankName: null, effectiveRole: null,
        characterId: null, isMain: false, community: { userId, role, joinedAt: '2026-10-01T12:00:00.000Z' },
    };
}

export const COMMUNITY_MEMBERS: readonly GuildMemberRow[] = [
    buildCommunityMember(1, 'Lead', 'leader'),
    buildCommunityMember(2, 'Offy', 'officer'),
    buildCommunityMember(3, 'Mem', 'member'),
];

interface PageOpts {
    role?: LadderRole;
    community?: Partial<GuildPageCommunity>;
    members?: readonly GuildMemberRow[];
}

/** A community hub page as `viewer.role`; defaults to an active hub the viewer has joined as a member. */
export function buildCommunityPage({ role = 'member', community = {}, members = COMMUNITY_MEMBERS }: PageOpts = {}): GuildPage {
    return {
        guild: {
            id: 41, gameId: 9, kind: 'game_community', name: 'BG3 Crew', region: 'community', realmSlug: null, realmName: null,
            faction: null, memberCount: members.length, lastSnapshotAt: null, status: community.status ?? 'active', blurb: 'Honour mode runs',
        },
        importedBy: null,
        viewer: { role, canEdit: role === 'leader' || role === 'officer', canManageEditors: role === 'leader' },
        ranks: [{ rankIndex: 0, rankName: 'Members', members: [...members] }],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        community: {
            status: 'active', blurb: 'Honour mode runs', viewerJoined: role !== 'visitor', viewerBanned: false, canJoin: true,
            joinBlockedReason: null, leader: { userId: 1, username: 'Lead', avatarUrl: null }, ...community,
        },
    };
}
