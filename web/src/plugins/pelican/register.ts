import { registerPlugin } from '../plugin-registry';
import { PelicanPluginSlot } from './slots/pelican-plugin-slot';
import { usePelicanCalendarItems } from './calendar/use-pelican-calendar-items';

/** Pelican game-server panel plugin (ROK-121). Neutral registry colour — no brand mark (spec Q7). */
const pelican = registerPlugin('pelican', {
    icon: '/plugins/pelican/badge.svg',
    color: '#64748B',
    label: 'Pelican',
});

// Gate + lazy panel: the panel's code stays out of the entry chunk (bundle budget).
pelican.registerSlot('admin-settings:plugin-content', PelicanPluginSlot);

// Server schedule windows + markers on the week/day calendar (ROK-1774). Registered at
// import time so the host's hook order is fixed before the first calendar render.
pelican.registerCalendarLayer({
    key: 'pelican:server-schedule',
    filterLabel: 'Server schedules',
    filterDescription: 'Restarts and up-windows from linked game servers',
    useItems: usePelicanCalendarItems,
});

// Feeds the generic GET /game-servers/status — the event page's status chip (ROK-1776).
pelican.registerGameServerProvider();
