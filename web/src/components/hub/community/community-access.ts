/**
 * ROK-1870 §2.5 — who may do what on a community hub, as pure functions so
 * the hero and the Members row menu read one matrix. The viewer's ladder role
 * comes from `page.viewer.role` (staff already resolve to `leader`, D4); a
 * row's role from `row.community.role`. Community rows carry the member's
 * user id in `memberId` (the `:userId` of the membership routes).
 */
import type { GuildPage, GuildPageCommunity, LadderRole } from '@raid-ledger/contract';
import type { HubMemberRow } from '../../../plugins/hub-module';

export type CommunityRowAction = 'remove' | 'ban' | 'make-officer' | 'make-member' | 'make-leader';

/** D7: officers act on members only; the leader acts on everyone but themself; nobody acts on the leader. */
export function communityRowActions(viewer: LadderRole, row: HubMemberRow, selfId: number | null): readonly CommunityRowAction[] {
    const target = row.community?.role;
    if (target === undefined || target === 'leader' || row.memberId === selfId) return [];
    if (viewer === 'officer') return target === 'member' ? ['remove', 'ban'] : [];
    if (viewer !== 'leader') return [];
    const role: CommunityRowAction = target === 'officer' ? 'make-member' : 'make-officer';
    return ['remove', 'ban', role, 'make-leader'];
}

const BLOCKED_COPY: Record<NonNullable<GuildPageCommunity['joinBlockedReason']>, string> = {
    'not-in-discord': 'Join the Discord server to join hubs',
    banned: "You can't join this hub",
    archived: 'This hub is archived',
};

/** Why Join is disabled, in the hero's words; `null` when Join is open. */
export function joinBlockedCopy(community: GuildPageCommunity): string | null {
    if (community.joinBlockedReason !== null) return BLOCKED_COPY[community.joinBlockedReason];
    return community.canJoin ? null : BLOCKED_COPY.archived;
}

/** D13: a leader with other live members must hand over before leaving. */
export function leaveNeedsTransfer(page: GuildPage): boolean {
    return page.viewer.role === 'leader' && page.community?.leader !== null && page.guild.memberCount > 1
        && page.community?.viewerJoined === true;
}
