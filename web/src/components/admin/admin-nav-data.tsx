import type { PluginInfoDto } from '@raid-ledger/contract';

/** Status info for integration sidebar items */
export type IntegrationStatus = 'online' | 'offline' | 'loading';

export interface NavItem {
    to: string;
    label: string;
    /** When true, the item shows a "New" badge via useNewBadge */
    newBadgeKey?: string;
    /** Integration status shown as a small pill badge */
    status?: IntegrationStatus;
    /** Source plugin name for plugin-installed integrations (e.g. "World of Warcraft") */
    pluginSource?: string;
}

export interface NavSection {
    id: string;
    label: string;
    icon: React.ReactNode;
    children: NavItem[];
}

const GeneralIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>);
const IntegrationsIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>);
const PluginsIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" /></svg>);
const AppearanceIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>);

/** Build core integration nav items with live status from hooks */
export function buildCoreIntegrationItems(statuses: {
    discord: { configured: boolean; loading: boolean };
    discordBot: { connected: boolean; configured: boolean; loading: boolean };
    igdb: { configured: boolean; loading: boolean };
}): NavItem[] {
    return [
        {
            to: '/admin/settings/integrations',
            label: 'Discord OAuth',
            status: statuses.discord.loading ? 'loading'
                : statuses.discord.configured ? 'online' : 'offline',
        },
        {
            to: '/admin/settings/integrations/discord-bot',
            label: 'Discord Bot',
            status: statuses.discordBot.loading ? 'loading'
                : statuses.discordBot.connected ? 'online' : 'offline',
        },
        {
            to: '/admin/settings/integrations/igdb',
            label: 'IGDB / Twitch',
            status: statuses.igdb.loading ? 'loading'
                : statuses.igdb.configured ? 'online' : 'offline',
        },
        {
            to: '/admin/settings/integrations/channel-bindings',
            label: 'Channel Bindings',
        },
    ];
}

/** Build integration nav items from active plugins. Plugin-installed integrations get a "New" badge key. */
export function buildPluginIntegrationItems(plugins: PluginInfoDto[]): NavItem[] {
    const items: NavItem[] = [];
    for (const plugin of plugins) {
        if (plugin.status !== 'active') continue;
        for (const integration of plugin.integrations) {
            items.push({
                to: `/admin/settings/integrations/plugin/${plugin.slug}/${integration.key}`,
                label: integration.name,
                newBadgeKey: `integration-nav-seen:${plugin.slug}:${integration.key}`,
                status: integration.configured ? 'online' : 'offline',
                pluginSource: plugin.name,
            });
        }
    }
    return items;
}

/** Build the full sections list, merging core and plugin integrations */
export function buildNavSections(coreIntegrations: NavItem[], pluginIntegrations: NavItem[]): NavSection[] {
    return [
        {
            id: 'general', label: 'General', icon: GeneralIcon, children: [
                { to: '/admin/settings/general', label: 'Site Settings' },
                { to: '/admin/settings/general/roles', label: 'Role Management' },
                { to: '/admin/settings/general/data', label: 'Demo Data' },
                { to: '/admin/settings/general/cron-jobs', label: 'Scheduled Jobs' },
            ]
        },
        {
            id: 'integrations', label: 'Integrations', icon: IntegrationsIcon, children: [
                ...coreIntegrations,
                ...pluginIntegrations,
            ]
        },
        {
            id: 'plugins', label: 'Plugins', icon: PluginsIcon, children: [
                { to: '/admin/settings/plugins', label: 'Manage Plugins' },
            ]
        },
        {
            id: 'appearance', label: 'Appearance', icon: AppearanceIcon, children: [
                { to: '/admin/settings/appearance', label: 'Branding' },
            ]
        },
    ];
}
