import { registerPlugin } from '../plugin-registry';
import { ValheimLinkTokenControl } from './slots/valheim-link-token-control';
import { registerServerHubGameTab } from '../pelican/hub/server-hub-game-tabs';
import { LazyValheimCharactersHubTab } from './hub/valheim-characters-hub-tab-lazy';
import { LazyValheimMapHubTab } from './hub/valheim-map-hub-tab-lazy';

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
