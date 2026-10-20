/**
 * ROK-1870 §2.5 — who may do what on a community hub, as pure functions so
 * the hero and the Members row menu read one matrix. The viewer's ladder role
 * comes from `page.viewer.role` (staff already resolve to `leader`, D4); a
 * row's role and user id from `row.community` — `row.community.userId` is the
 * `:userId` of the membership routes (`memberId` is the membership row id).
 */
import type { GuildPage, GuildPageCommunity, LadderRole } from '@raid-ledger/contract';
import type { HubMemberRow } from '../../../plugins/hub-module';

export type CommunityRowAction = 'remove' | 'ban' | 'make-officer' | 'make-member' | 'make-leader';

/** D7: officers act on members only; the leader acts on everyone but themself; nobody acts on the leader. */
export function communityRowActions(viewer: LadderRole, row: HubMemberRow, selfId: number | null): readonly CommunityRowAction[] {
    const target = row.community?.role;
    if (target === undefined || target === 'leader' || row.community?.userId === selfId) return [];
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

/**
 * D13: the hub's own leader, with other live members, must hand over before
 * leaving. Keyed on the leader's user id, not the ladder role — staff resolve
 * to `leader` (D4) but a staff member who joined as a member just leaves.
 */
export function leaveNeedsTransfer(page: GuildPage, selfId: number | null): boolean {
    const c = page.community;
    return c !== undefined && c.viewerJoined && selfId !== null && c.leader?.userId === selfId && page.guild.memberCount > 1;
}
