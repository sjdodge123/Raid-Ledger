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
    /** Plugin slug — used to look up the plugin badge image */
    pluginSlug?: string;
}

export interface NavSection {
    id: string;
    label: string;
    icon: React.ReactNode;
    children: NavItem[];
}

const GeneralIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>);
const IntegrationsIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>);

/** Build core integration nav items with live status from hooks */
export function buildCoreIntegrationItems(statuses: {
    discord: { configured: boolean; loading: boolean };
    discordBot: { connected: boolean; configured: boolean; loading: boolean };
    igdb: { configured: boolean; loading: boolean };
}): NavItem[] {
    const discordLoading = statuses.discord.loading || statuses.discordBot.loading;
    const discordOnline = statuses.discord.configured && statuses.discordBot.connected;

    return [
        {
            to: '/admin/settings/integrations/discord',
            label: 'Discord',
            status: discordLoading ? 'loading'
                : discordOnline ? 'online' : 'offline',
        },
        {
            to: '/admin/settings/integrations/igdb',
            label: 'IGDB / Twitch',
            status: statuses.igdb.loading ? 'loading'
                : statuses.igdb.configured ? 'online' : 'offline',
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
                pluginSlug: plugin.slug,
            });
        }
    }
    return items;
}

/**
 * Build the full sections list (ROK-359 consolidated).
 *
 * Changes from pre-ROK-359:
 * - General: Site Settings now includes Branding; Demo Data conditionally hidden when not in DEMO_MODE
 * - Integrations: Plugins (Manage Plugins) folded in at the end
 * - Appearance section removed (merged into General > Site Settings)
 * - Plugins section removed (moved into Integrations)
 */
export function buildNavSections(
    coreIntegrations: NavItem[],
    pluginIntegrations: NavItem[],
    options?: { demoMode?: boolean },
): NavSection[] {
    const generalChildren: NavItem[] = [
        { to: '/admin/settings/general', label: 'Site Settings' },
        { to: '/admin/settings/general/roles', label: 'User Management' },
        { to: '/admin/settings/general/cron-jobs', label: 'Scheduled Jobs' },
        { to: '/admin/settings/general/backups', label: 'Backups' },
    ];

    // Demo Data conditionally shown when DEMO_MODE is active
    if (options?.demoMode) {
        generalChildren.splice(2, 0, { to: '/admin/settings/general/data', label: 'Demo Data' });
    }

    return [
        {
            id: 'general', label: 'General', icon: GeneralIcon, children: generalChildren,
        },
        {
            id: 'integrations', label: 'Integrations', icon: IntegrationsIcon, children: [
                ...coreIntegrations,
                ...pluginIntegrations,
                { to: '/admin/settings/plugins', label: 'Manage Plugins' },
            ]
        },
    ];
}
