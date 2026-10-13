import { registerPlugin } from '../plugin-registry';
import { PelicanPluginSlot } from './slots/pelican-plugin-slot';

/** Pelican game-server panel plugin (ROK-121). Neutral registry colour — no brand mark (spec Q7). */
const pelican = registerPlugin('pelican', {
    icon: '/plugins/pelican/badge.svg',
    color: '#64748B',
    label: 'Pelican',
});

// Gate + lazy panel: the panel's code stays out of the entry chunk (bundle budget).
pelican.registerSlot('admin-settings:plugin-content', PelicanPluginSlot);
