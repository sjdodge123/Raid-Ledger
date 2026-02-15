import { Link, useLocation } from 'react-router-dom';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { useRelaySettings } from '../../hooks/use-relay-settings';
import { useNewBadge } from '../../hooks/use-new-badge';
import { NewBadge } from '../ui/new-badge';
import type { PluginInfoDto } from '@raid-ledger/contract';

/** Status info for integration sidebar items */
type IntegrationStatus = 'online' | 'offline' | 'loading';

interface NavItem {
    to: string;
    label: string;
    /** When true, the item shows a "New" badge via useNewBadge */
    newBadgeKey?: string;
    /** Integration status shown as a small pill badge */
    status?: IntegrationStatus;
    /** Source plugin name for plugin-installed integrations (e.g. "World of Warcraft") */
    pluginSource?: string;
}

interface NavSection {
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
function buildCoreIntegrationItems(statuses: {
    discord: { configured: boolean; loading: boolean };
    discordBot: { connected: boolean; configured: boolean; loading: boolean };
    igdb: { configured: boolean; loading: boolean };
    relay: { connected: boolean; loading: boolean };
    github: { configured: boolean; loading: boolean };
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
            to: '/admin/settings/integrations/relay',
            label: 'Relay Hub',
            status: statuses.relay.loading ? 'loading'
                : statuses.relay.connected ? 'online' : 'offline',
        },
        {
            to: '/admin/settings/integrations/github',
            label: 'GitHub',
            status: statuses.github.loading ? 'loading'
                : statuses.github.configured ? 'online' : 'offline',
        },
    ];
}

/** Build integration nav items from active plugins. Plugin-installed integrations get a "New" badge key. */
function buildPluginIntegrationItems(plugins: PluginInfoDto[]): NavItem[] {
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
function buildNavSections(coreIntegrations: NavItem[], pluginIntegrations: NavItem[]): NavSection[] {
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

interface AdminSidebarProps { isOpen?: boolean; onNavigate?: () => void; }

/**
 * Admin settings sidebar navigation.
 * All sections are always expanded (no accordion collapse).
 * Integration items show at-a-glance status badges (Online / Offline).
 * Plugin-installed integrations appear in the Integrations section with "New" badges.
 */
export function AdminSidebar({ isOpen = true, onNavigate }: AdminSidebarProps) {
    const location = useLocation();
    const { plugins } = usePluginAdmin();
    const { oauthStatus, igdbStatus, githubStatus, discordBotStatus } = useAdminSettings();
    const { relayStatus } = useRelaySettings();

    const coreIntegrations = buildCoreIntegrationItems({
        discord: {
            configured: oauthStatus.data?.configured ?? false,
            loading: oauthStatus.isLoading,
        },
        discordBot: {
            connected: discordBotStatus.data?.connected ?? false,
            configured: discordBotStatus.data?.configured ?? false,
            loading: discordBotStatus.isLoading,
        },
        igdb: {
            configured: igdbStatus.data?.configured ?? false,
            loading: igdbStatus.isLoading,
        },
        relay: {
            connected: relayStatus.data?.connected ?? false,
            loading: relayStatus.isLoading,
        },
        github: {
            configured: githubStatus.data?.configured ?? false,
            loading: githubStatus.isLoading,
        },
    });
    const pluginIntegrations = buildPluginIntegrationItems(plugins.data ?? []);
    const sections = buildNavSections(coreIntegrations, pluginIntegrations);

    if (!isOpen) return null;

    return (
        <nav className="w-full h-full overflow-y-auto py-4 pr-2" aria-label="Admin settings navigation">
            <div className="space-y-4">
                {sections.map((section) => (
                    <div key={section.id}>
                        <div className="flex items-center gap-2.5 px-3 py-1.5 text-secondary">
                            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                                {section.icon}{section.label}
                            </span>
                        </div>
                        <div className="mt-1 space-y-0.5">
                            {section.children.map((child) => (
                                <SidebarNavItem
                                    key={child.to}
                                    item={child}
                                    isActive={location.pathname === child.to}
                                    onNavigate={onNavigate}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </nav>
    );
}

/** Small status pill for integration sidebar items */
function StatusPill({ status }: { status: IntegrationStatus }) {
    if (status === 'loading') return null;

    const config = {
        online: { label: 'Online', className: 'bg-emerald-500/20 text-emerald-400' },
        offline: { label: 'Offline', className: 'bg-red-500/15 text-red-400' },
    } as const;

    const { label, className } = config[status];

    return (
        <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight ${className}`}>
            {label}
        </span>
    );
}

/** Individual nav link. Renders status pills for integrations and "New" badges for plugin items. */
function SidebarNavItem({
    item,
    isActive,
    onNavigate,
}: {
    item: NavItem;
    isActive: boolean;
    onNavigate?: () => void;
}) {
    const { isNew, markSeen } = useNewBadge(item.newBadgeKey ?? '');

    return (
        <Link
            to={item.to}
            onClick={onNavigate}
            onMouseEnter={item.newBadgeKey ? markSeen : undefined}
            title={item.pluginSource ? `Installed by ${item.pluginSource}` : undefined}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${item.pluginSource ? 'border-l-2 border-indigo-400/60 ' : ''
                }${isActive
                    ? 'text-emerald-400 bg-emerald-500/10 font-medium'
                    : 'text-muted hover:text-foreground hover:bg-overlay/20'
                }`}
        >
            <span className="truncate min-w-0 flex-1">{item.label}</span>
            {item.newBadgeKey && <NewBadge visible={isNew} />}
            {item.status && <StatusPill status={item.status} />}
        </Link>
    );
}
