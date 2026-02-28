import { registerPlugin } from '../plugin-registry';

// Guard against HMR re-execution pushing duplicate registrations
let registered = false;
if (!registered) {
    registered = true;

    registerPlugin('discord', {
        icon: '/plugins/discord/badge.svg',
        color: '#5865F2',
        label: 'Discord',
    });
}
