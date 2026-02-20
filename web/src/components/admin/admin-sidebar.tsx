import { Link, useLocation } from 'react-router-dom';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { useNewBadge } from '../../hooks/use-new-badge';
import { NewBadge } from '../ui/new-badge';
import type { IntegrationStatus, NavItem } from './admin-nav-data';
import { buildCoreIntegrationItems, buildPluginIntegrationItems, buildNavSections } from './admin-nav-data';

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
    const { oauthStatus, igdbStatus, discordBotStatus } = useAdminSettings();

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
export function StatusPill({ status }: { status: IntegrationStatus }) {
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
export function SidebarNavItem({
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
            className={`flex items-center gap-2 px-3 py-3 min-h-[44px] rounded-lg text-sm transition-colors ${isActive
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
