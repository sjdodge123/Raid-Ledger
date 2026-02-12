import { Link, useLocation } from 'react-router-dom';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import { useNewBadge } from '../../hooks/use-new-badge';
import { NewBadge } from '../ui/new-badge';
import type { PluginInfoDto } from '@raid-ledger/contract';

interface NavItem {
    to: string;
    label: string;
    /** When true, the item shows a "New" badge via useNewBadge */
    newBadgeKey?: string;
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

/** Static (core) integration nav items */
const CORE_INTEGRATION_ITEMS: NavItem[] = [
    { to: '/admin/settings/integrations', label: 'Discord OAuth' },
    { to: '/admin/settings/integrations/igdb', label: 'IGDB / Twitch' },
    { to: '/admin/settings/integrations/relay', label: 'Relay Hub' },
];

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
            });
        }
    }
    return items;
}

/** Build the full sections list, merging static nav with dynamic plugin integrations */
function buildNavSections(pluginIntegrations: NavItem[]): NavSection[] {
    return [
        { id: 'general', label: 'General', icon: GeneralIcon, children: [
            { to: '/admin/settings/general', label: 'Site Settings' },
            { to: '/admin/settings/general/roles', label: 'Role Management' },
            { to: '/admin/settings/general/data', label: 'Demo Data' },
        ]},
        { id: 'integrations', label: 'Integrations', icon: IntegrationsIcon, children: [
            ...CORE_INTEGRATION_ITEMS,
            ...pluginIntegrations,
        ]},
        { id: 'plugins', label: 'Plugins', icon: PluginsIcon, children: [
            { to: '/admin/settings/plugins', label: 'Manage Plugins' },
        ]},
        { id: 'appearance', label: 'Appearance', icon: AppearanceIcon, children: [
            { to: '/admin/settings/appearance', label: 'Branding' },
            { to: '/admin/settings/appearance/theme', label: 'Theme' },
        ]},
    ];
}

interface AdminSidebarProps { isOpen?: boolean; onNavigate?: () => void; }

/**
 * Admin settings sidebar navigation.
 * All sections are always expanded (no accordion collapse).
 * Plugin-installed integrations appear in the Integrations section with "New" badges.
 */
export function AdminSidebar({ isOpen = true, onNavigate }: AdminSidebarProps) {
    const location = useLocation();
    const { plugins } = usePluginAdmin();

    const pluginIntegrations = buildPluginIntegrationItems(plugins.data ?? []);
    const sections = buildNavSections(pluginIntegrations);

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

/** Individual nav link. Renders a "New" badge for plugin-installed integration items. */
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
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                    ? 'text-emerald-400 bg-emerald-500/10 font-medium'
                    : 'text-muted hover:text-foreground hover:bg-overlay/20'
            }`}
        >
            <span>{item.label}</span>
            {item.newBadgeKey && <NewBadge visible={isNew} />}
        </Link>
    );
}
