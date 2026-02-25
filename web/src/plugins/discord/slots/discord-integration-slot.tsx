import { DiscordPanel } from '../../../pages/admin/discord-panel';

/**
 * Plugin slot component that renders the full Discord integration panel
 * (OAuth + Bot + Channel Bindings) inside the plugin content area.
 * Only renders when the current pluginSlug context matches 'discord'.
 */
export function DiscordIntegrationSlot({ pluginSlug }: { pluginSlug?: string }) {
    if (pluginSlug && pluginSlug !== 'discord') return null;
    return <DiscordPanel />;
}
