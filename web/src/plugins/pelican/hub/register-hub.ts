/**
 * ROK-1831 — the game-server hub module (`kind: 'game_server'`). Core's
 * `/guilds/:id` shell renders it while the Pelican plugin is active. No
 * Officers, no rank bands; members are whoever played here in 90 days or
 * pressed Join. The hub name comes from the server (core has no name editor).
 */
import type { HubModule } from '../../hub-module';
import { JoinLeavePill, ServerStatusPill } from './server-hero';
import { SERVER_MEMBER_COLUMNS } from './server-member-columns';
import { QuickPlayTab } from './quick-play-tab';
import { serverHubGameTabs } from './server-hub-game-tabs';
import { RecentArrivalsWidget } from './recent-arrivals-widget';

/** A visitor gets no member rows (server-side), so the empty line invites a Join. */
export const SERVER_MEMBERS_VISITOR_EMPTY = 'Join to see who plays here';

export const pelicanHubModule: HubModule = {
    kind: 'game_server',
    get tabs() {
        return [{ id: 'quick-play', label: 'Quick Play', order: 10, component: QuickPlayTab }, ...serverHubGameTabs()];
    },
    overviewWidgets: [{ id: 'recent-arrivals', order: 55, component: RecentArrivalsWidget, visible: ({ page }) => page.server !== undefined }],
    memberColumns: SERVER_MEMBER_COLUMNS,
    heroPills: [ServerStatusPill, JoinLeavePill],
    memberRows: (page) => page.ranks.flatMap((g) => g.members),
    membersBlurb: () => 'Played here in the last 90 days, or joined',
    membersEmpty: (page) => (page.server?.viewerJoined === false ? SERVER_MEMBERS_VISITOR_EMPTY : 'No one has played here yet.'),
};
