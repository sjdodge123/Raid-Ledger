/**
 * ROK-1831 — the game-server hub module (`kind: 'game_server'`). Core's
 * `/guilds/:id` shell renders it while the Pelican plugin is active. No
 * Officers, no rank bands; members are whoever played here in 90 days or
 * pressed Join. The hub name comes from the server (core has no name editor).
 */
import type { CoreWidgetId, HubCtx, HubModule } from '../../hub-module';
import { JoinLeavePill, ServerStatusPill } from './server-hero';
import { SERVER_MEMBER_COLUMNS } from './server-member-columns';
import { LazyQuickPlayTab } from './quick-play-tab-lazy';
import { serverHubGameTabs } from './server-hub-game-tabs';
import { RecentArrivalsWidget } from './recent-arrivals-widget';
import { LazyServerHoursWidget } from './server-hours-widget-lazy';

/** A visitor gets no member rows (server-side), so the empty line invites a Join. */
export const SERVER_MEMBERS_VISITOR_EMPTY = 'Join to see who plays here';

/** Core widgets whose endpoints are members-only on a server hub — a visitor never sees them (no 403 card). */
const MEMBERS_ONLY_CORE = new Set<CoreWidgetId>(['gm-post', 'discord']);

/** A member (presence or Join) or staff; a visitor gets neither the post nor the Discord mirror. */
export function serverCoreWidgetVisible(id: CoreWidgetId, { page }: HubCtx): boolean {
    if (!MEMBERS_ONLY_CORE.has(id)) return true;
    return page.server?.viewerJoined === true || page.viewer.role !== 'visitor';
}

export const pelicanHubModule: HubModule = {
    kind: 'game_server',
    get tabs() {
        return [{ id: 'quick-play', label: 'Quick Play', order: 10, component: LazyQuickPlayTab }, ...serverHubGameTabs()];
    },
    overviewWidgets: [
        // ROK-1876: every viewer (operator ruling 2026-10-21) — hours are not sensitive.
        { id: 'server-hours', order: 50, component: LazyServerHoursWidget, visible: ({ page }) => page.server !== undefined },
        { id: 'recent-arrivals', order: 55, component: RecentArrivalsWidget, visible: ({ page }) => page.server !== undefined },
    ],
    coreWidgetVisible: serverCoreWidgetVisible,
    memberColumns: SERVER_MEMBER_COLUMNS,
    heroPills: [ServerStatusPill, JoinLeavePill],
    memberRows: (page) => page.ranks.flatMap((g) => g.members),
    membersBlurb: () => 'Played here in the last 90 days, or joined',
    membersEmpty: (page) => (page.server?.viewerJoined === false ? SERVER_MEMBERS_VISITOR_EMPTY : 'No one has played here yet.'),
};
