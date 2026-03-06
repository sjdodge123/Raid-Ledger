import { Link, useNavigate } from 'react-router-dom';
import { SECTIONS as PROFILE_SECTIONS } from '../profile/profile-nav-data';
import { useResetOnboarding } from '../../hooks/use-onboarding-fte';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import {
    buildCoreIntegrationItems,
    buildPluginIntegrationItems,
    buildDiscordNavItems,
    buildNavSections,
} from '../admin/admin-nav-data';
import { SidebarNavItem } from '../admin/admin-sidebar';
import { usePluginStore } from '../../stores/plugin-store';

/** Profile submenu -- renders profile nav sections inline in the MoreDrawer */
export function ProfileSubmenuContent({ pathname, onClose }: { pathname: string; onClose: () => void }) {
    const navigate = useNavigate();
    const resetOnboarding = useResetOnboarding();

    const sections = PROFILE_SECTIONS;

    const handleRerunWizard = () => {
        resetOnboarding.mutate(undefined, {
            onSuccess: () => {
                onClose();
                navigate('/onboarding?rerun=1');
            },
        });
    };

    return (
        <div className="px-4 pb-3 space-y-3" data-testid="profile-submenu">
            {sections.map((section) => (
                <div key={section.id}>
                    <div className="flex items-center gap-2 px-3 py-1.5 text-secondary">
                        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                            {section.icon}
                            {section.label}
                        </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                        {section.children.map((child) => (
                            <Link
                                key={child.to}
                                to={child.to}
                                onClick={onClose}
                                className={`flex items-center gap-2 px-3 py-3 min-h-[44px] rounded-lg text-sm transition-colors ${pathname === child.to
                                    ? 'text-emerald-400 bg-emerald-500/10 font-medium'
                                    : 'text-muted hover:text-foreground hover:bg-overlay/20'
                                    }`}
                            >
                                <span className="truncate min-w-0 flex-1">{child.label}</span>
                            </Link>
                        ))}
                    </div>
                </div>
            ))}

            {/* Setup Wizard re-run */}
            <div className="border-t border-edge/30 pt-3">
                <button
                    onClick={handleRerunWizard}
                    disabled={resetOnboarding.isPending}
                    className="flex items-center gap-2 px-3 py-3 min-h-[44px] rounded-lg text-sm text-muted hover:text-foreground hover:bg-overlay/20 transition-colors w-full"
                >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className="truncate min-w-0 flex-1">
                        {resetOnboarding.isPending ? 'Resetting...' : 'Re-run Setup Wizard'}
                    </span>
                </button>
            </div>
        </div>
    );
}

/**
 * Admin submenu -- conditionally rendered so hooks only fire when expanded.
 * Uses the same builder functions and SidebarNavItem from admin-sidebar.
 */
export function AdminSubmenuContent({ pathname, onClose }: { pathname: string; onClose: () => void }) {
    const { plugins } = usePluginAdmin();
    const { igdbStatus, oauthStatus, discordBotStatus } = useAdminSettings();
    const isDiscordActive = usePluginStore((s) => s.isPluginActive('discord'));
    const coreIntegrations = buildCoreIntegrationItems({
        igdb: {
            configured: igdbStatus.data?.configured ?? false,
            loading: igdbStatus.isLoading,
        },
    });
    const pluginIntegrations = buildPluginIntegrationItems(plugins.data ?? []);
    const discordItems = isDiscordActive
        ? buildDiscordNavItems(
            {
                connected: discordBotStatus.data?.connected ?? false,
                connecting: discordBotStatus.data?.connecting ?? false,
            },
            {
                configured: oauthStatus.data?.configured ?? false,
                loading: oauthStatus.isLoading,
            },
        )
        : null;
    const sections = buildNavSections(coreIntegrations, pluginIntegrations, discordItems);

    return (
        <div className="px-4 pb-3 space-y-3" data-testid="admin-submenu">
            {sections.map((section) => (
                <div key={section.id}>
                    <div className="flex items-center gap-2.5 px-3 py-1.5 text-secondary">
                        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                            {section.icon}
                            {section.label}
                        </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                        {section.children.map((child) => (
                            <SidebarNavItem
                                key={child.to}
                                item={child}
                                isActive={pathname === child.to}
                                onNavigate={onClose}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
