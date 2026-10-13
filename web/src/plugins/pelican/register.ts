import { registerPlugin } from '../plugin-registry';
import { PelicanPluginContent } from './slots/pelican-plugin-content';

/** Pelican game-server panel plugin (ROK-121). Neutral registry colour — no brand mark (spec Q7). */
const pelican = registerPlugin('pelican', {
    icon: '/plugins/pelican/badge.svg',
    color: '#64748B',
    label: 'Pelican',
});

pelican.registerSlot('admin-settings:plugin-content', PelicanPluginContent);
