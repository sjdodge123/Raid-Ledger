import { registerPlugin } from '../plugin-registry';
import { DiscordIntegrationSlot } from './slots/discord-integration-slot';

// Guard against HMR re-execution pushing duplicate registrations
let registered = false;
if (!registered) {
    registered = true;

    const discord = registerPlugin('discord', {
        icon: '/plugins/discord/badge.svg',
        color: '#5865F2',
        label: 'Discord',
    });

    discord.registerSlot('admin-settings:plugin-content', DiscordIntegrationSlot);
}
