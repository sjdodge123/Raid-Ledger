import { registerPlugin } from '../plugin-registry';
import { ValheimLinkTokenControl } from './slots/valheim-link-token-control';

/** Valheim plugin (ROK-1833) — the slug matches the api manifest id `valheim`. Neutral registry colour. */
const valheim = registerPlugin('valheim', {
    icon: '🪓',
    color: '#64748B',
    label: 'Valheim',
});

// The mod-link token control on each Pelican admin server row; self-filters to Valheim-mapped rows.
valheim.registerSlot('pelican-server:row-extras', ValheimLinkTokenControl);
