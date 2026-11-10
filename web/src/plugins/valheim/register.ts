import type { HubCtx } from '../hub-module';
import { registerPlugin } from '../plugin-registry';
import { ValheimLinkTokenControl } from './slots/valheim-link-token-control';
import { LazyValheimCharactersHubTab } from './hub/valheim-characters-hub-tab-lazy';
import { LazyValheimMapHubTab } from './hub/valheim-map-hub-tab-lazy';
import { LazyValheimMaterialsHubTab } from './hub/valheim-materials-hub-tab-lazy';
import { LazyValheimPlannerHubTab } from './hub/valheim-planner-hub-tab-lazy';
import { valheimHubClaimProvider } from './hub/valheim-hub-claim-provider';
import { LazyValheimDeathsWidget } from './hub/valheim-deaths-widget-lazy';
import { ValheimDeathsShowAll } from './hub/valheim-deaths-show-all';
import { useDeathsWidgetVisible } from './hooks/use-valheim-deaths-visible';

/** Valheim plugin (ROK-1833) — the slug matches the api manifest id `valheim`. Neutral registry colour. */
const valheim = registerPlugin('valheim', {
    icon: '🪓',
    color: '#64748B',
    label: 'Valheim',
});

// The mod-link token control on each Pelican admin server row; self-filters to Valheim-mapped rows.
valheim.registerSlot('pelican-server:row-extras', ValheimLinkTokenControl);

/**
 * Every Valheim tab reads the hub's server block; a `game_community` hub of Valheim, or a server hub
 * whose mapping was cleared, has none, so the tabs stay out of the band rather than render blank.
 */
const hasServer = ({ page }: HubCtx): boolean => page.server !== undefined;

// The hub Characters tab (ROK-1836) — only on hubs of the Valheim game.
valheim.registerHubGameTab(['valheim'], {
    id: 'characters',
    label: 'Characters',
    order: 15,
    component: LazyValheimCharactersHubTab,
    visible: hasServer,
});

// The hub Map tab (ROK-1837) — only on hubs of the Valheim game; the map is a lazy chunk.
valheim.registerHubGameTab(['valheim'], {
    id: 'map',
    label: 'Map',
    order: 20,
    component: LazyValheimMapHubTab,
    visible: hasServer,
});

// The hub Materials tab (ROK-1853) — chest totals; only on hubs of the Valheim game.
valheim.registerHubGameTab(['valheim'], {
    id: 'materials',
    label: 'Materials',
    order: 25,
    component: LazyValheimMaterialsHubTab,
    visible: hasServer,
});

// The hub Planner tab (ROK-1854 D10) — recipe trees + a shopping list; only on hubs of the Valheim game.
valheim.registerHubGameTab(['valheim'], {
    id: 'planner',
    label: 'Planner',
    order: 30,
    component: LazyValheimPlannerHubTab,
    visible: hasServer,
});

// ROK-2153 S4 — "claim your character" on the core Overview prompt (replaces the ROK-1933 Overview
// claim-banner widget); server hubs only. The Characters tab keeps its own banner.
valheim.registerHubClaimProvider(valheimHubClaimProvider);

// ROK-1930 — per-player death counts on the Overview, after the core cards (Q7); members + staff
// (staff resolve as Leader). The route also 404s visitors server-side (D6); hidden with no deaths.
valheim.registerHubWidget({
    id: 'deaths',
    title: 'Deaths',
    games: ['valheim'],
    kinds: ['game_server'],
    order: 45,
    span: 1,
    audience: 'members',
    component: LazyValheimDeathsWidget,
    action: ValheimDeathsShowAll,
    useVisible: useDeathsWidgetVisible,
});
