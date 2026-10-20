import { registerPlugin } from '../plugin-registry';
import { ValheimLinkTokenControl } from './slots/valheim-link-token-control';
import { registerServerHubGameTab } from '../pelican/hub/server-hub-game-tabs';
import { LazyValheimCharactersHubTab } from './hub/valheim-characters-hub-tab-lazy';
import { LazyValheimMapHubTab } from './hub/valheim-map-hub-tab-lazy';
import { LazyValheimMaterialsHubTab } from './hub/valheim-materials-hub-tab-lazy';
import { LazyValheimPlannerHubTab } from './hub/valheim-planner-hub-tab-lazy';

/** Valheim plugin (ROK-1833) — the slug matches the api manifest id `valheim`. Neutral registry colour. */
const valheim = registerPlugin('valheim', {
    icon: '🪓',
    color: '#64748B',
    label: 'Valheim',
});

// The mod-link token control on each Pelican admin server row; self-filters to Valheim-mapped rows.
valheim.registerSlot('pelican-server:row-extras', ValheimLinkTokenControl);

// The hub Characters tab (ROK-1836) — only on server hubs running Valheim.
registerServerHubGameTab('valheim', {
    id: 'characters',
    label: 'Characters',
    order: 15,
    component: LazyValheimCharactersHubTab,
});

// The hub Map tab (ROK-1837) — only on server hubs running Valheim; the map is a lazy chunk.
registerServerHubGameTab('valheim', {
    id: 'map',
    label: 'Map',
    order: 20,
    component: LazyValheimMapHubTab,
});

// The hub Materials tab (ROK-1853) — chest totals; only on server hubs running Valheim.
registerServerHubGameTab('valheim', {
    id: 'materials',
    label: 'Materials',
    order: 25,
    component: LazyValheimMaterialsHubTab,
});

// The hub Planner tab (ROK-1854 D10) — recipe trees + a shopping list; only on server hubs running Valheim.
registerServerHubGameTab('valheim', {
    id: 'planner',
    label: 'Planner',
    order: 30,
    component: LazyValheimPlannerHubTab,
});
