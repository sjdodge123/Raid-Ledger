import { Link, useLocation } from 'react-router-dom';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { useSystemStatus } from '../../hooks/use-system-status';
import { useNewBadge } from '../../hooks/use-new-badge';
import { useSeenAdminSections } from '../../hooks/use-seen-admin-sections';
import { NewBadge } from '../ui/new-badge';
import { PluginBadge } from '../ui/plugin-badge';
import { getPluginBadge } from '../../plugins/plugin-registry';
import type { IntegrationStatus, NavItem, NavSection } from './admin-nav-data';
import { buildCoreIntegrationItems, buildPluginIntegrationItems, buildNavSections } from './admin-nav-data';

interface AdminSidebarProps { isOpen?: boolean; onNavigate?: () => void; }

/**
 * Admin settings sidebar navigation.
 * All sections are always expanded (no accordion collapse).
 * Integration items show at-a-glance status badges (Online / Offline).
 * Plugin-installed integrations appear in the Integrations section with "New" badges.
 * Parent section headers show a dot indicator when any child has an unseen "New" badge (ROK-285).
 */
export function AdminSidebar({ isOpen = true, onNavigate }: AdminSidebarProps) {
    const location = useLocation();
    const { plugins } = usePluginAdmin();
    const { igdbStatus } = useAdminSettings();
    const { data: systemStatus } = useSystemStatus();

    const coreIntegrations = buildCoreIntegrationItems({
        igdb: {
            configured: igdbStatus.data?.configured ?? false,
            loading: igdbStatus.isLoading,
        },
    });
    const pluginIntegrations = buildPluginIntegrationItems(plugins.data ?? []);
    const sections = buildNavSections(coreIntegrations, pluginIntegrations, {
        demoMode: systemStatus?.demoMode ?? false,
    });

    if (!isOpen) return null;

    return (
        <nav className="w-full h-full overflow-y-auto py-4 px-2" aria-label="Admin settings navigation">
            <div className="space-y-4">
                {sections.map((section) => (
                    <SidebarSection
                        key={section.id}
                        section={section}
                        currentPath={location.pathname}
                        onNavigate={onNavigate}
                    />
                ))}
            </div>
        </nav>
    );
}

/** Section group with parent badge indicator when any child has unseen "New" badge. */
function SidebarSection({
    section,
    currentPath,
    onNavigate,
}: {
    section: NavSection;
    currentPath: string;
    onNavigate?: () => void;
}) {
    const { isNew } = useSeenAdminSections();
    const hasNewChild = section.children.some((child) => child.newBadgeKey && isNew(child.newBadgeKey));

    return (
        <div>
            <div className="flex items-center gap-2.5 px-3 py-1.5 text-secondary">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                    {section.icon}{section.label}
                </span>
                {hasNewChild && (
                    <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" aria-label="New items" />
                )}
            </div>
            <div className="mt-1 space-y-0.5">
                {section.children.map((child) => (
                    <SidebarNavItem
                        key={child.to}
                        item={child}
                        isActive={currentPath === child.to}
                        onNavigate={onNavigate}
                    />
                ))}
            </div>
        </div>
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
    const { isNew } = useNewBadge(item.newBadgeKey ?? '', isActive);
    const badge = item.pluginSlug ? getPluginBadge(item.pluginSlug) : undefined;

    return (
        <Link
            to={item.to}
            onClick={onNavigate}
            title={item.pluginSource ? `Installed by ${item.pluginSource}` : undefined}
            className={`flex items-center gap-2 px-3 py-3 min-h-[44px] rounded-lg text-sm transition-colors ${isActive
                    ? 'text-emerald-400 bg-emerald-500/10 font-medium'
                    : 'text-muted hover:text-foreground hover:bg-overlay/20'
                }`}
        >
            {badge && (
                <PluginBadge
                    icon={badge.iconSmall ?? badge.icon}
                    label={badge.label}
                    size="sm"
                />
            )}
            <span className="truncate min-w-0 flex-1">{item.label}</span>
            {item.newBadgeKey && <NewBadge visible={isNew} />}
            {item.status && <StatusPill status={item.status} />}
        </Link>
    );
}
