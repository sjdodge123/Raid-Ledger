/**
 * ROK-1870 §3.1 (A4/D2) — the CORE hub module for `game_community`. No
 * plugin owns this kind, so `useHubModule` returns it before consulting the
 * plugin registry. No tabs of its own: Overview / Members / Events (+ Posts
 * and Resources as the shell provides) — never server or WoW tabs. Every core
 * Overview widget shows to visitors too (D14).
 */
import type { HubModule } from '../../../plugins/hub-module';
import { CommunityJoinPill, CommunityKindPill } from './community-hero';
import { COMMUNITY_MEMBER_COLUMNS } from './community-member-cells';
import { CommunityMemberActions } from './community-member-actions';

export const COMMUNITY_MEMBERS_VISITOR_EMPTY = "Join to see who's here";
export const COMMUNITY_MEMBERS_ALONE = 'Just you so far — share the hub link';

export const communityHubModule: HubModule = {
    kind: 'game_community',
    tabs: [],
    overviewWidgets: [],
    coreWidgetVisible: () => true,
    memberColumns: COMMUNITY_MEMBER_COLUMNS,
    memberActions: CommunityMemberActions,
    heroPills: [CommunityKindPill, CommunityJoinPill],
    memberRows: (page) => page.ranks.flatMap((g) => g.members),
    membersBlurb: (page) => `${page.guild.memberCount} ${page.guild.memberCount === 1 ? 'member' : 'members'}`,
    membersEmpty: (page) => (page.community?.viewerJoined === true ? COMMUNITY_MEMBERS_ALONE : COMMUNITY_MEMBERS_VISITOR_EMPTY),
};
