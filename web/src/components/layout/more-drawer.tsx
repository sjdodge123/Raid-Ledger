import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin, isOperatorOrAdmin } from '../../hooks/use-auth';
import { useThemeStore } from '../../stores/theme-store';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import { Z_INDEX } from '../../lib/z-index';
import { useQuery } from '@tanstack/react-query';
import { getAuthToken } from '../../hooks/use-auth';
import { API_BASE_URL } from '../../lib/config';
import { SECTIONS as PROFILE_SECTIONS } from '../profile/profile-nav-data';
import { useResetOnboarding } from '../../hooks/use-onboarding-fte';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import {
    buildCoreIntegrationItems,
    buildPluginIntegrationItems,
    buildNavSections,
} from '../admin/admin-nav-data';
import { SidebarNavItem } from '../admin/admin-sidebar';

interface MoreDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onFeedbackClick?: () => void;
}

/**
 * Full-screen mobile "More" drawer (ROK-332).
 * Replaces the 288px MobileNav with a full-screen left-sliding panel
 * featuring avatar, navigation, theme cycling, and logout.
 */
export function MoreDrawer({ isOpen, onClose, onFeedbackClick }: MoreDrawerProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, isAuthenticated, isImpersonating, logout, impersonate, exitImpersonation } = useAuth();
    const themeMode = useThemeStore((s) => s.themeMode);
    const cycleTheme = useThemeStore((s) => s.cycleTheme);

    // Close on route change
    const prevPathRef = useRef(location.pathname);
    useEffect(() => {
        if (prevPathRef.current !== location.pathname) {
            prevPathRef.current = location.pathname;
            onClose();
        }
    }, [location.pathname, onClose]);

    // Close on Escape + lock body scroll
    useEffect(() => {
        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                onClose();
            }
        }

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    const handleLogout = () => {
        logout();
        onClose();
        navigate('/', { replace: true });
    };

    const avatarResolved = user ? resolveAvatar(toAvatarUser(user)) : null;
    const avatarUrl = avatarResolved?.url;
    const [avatarError, setAvatarError] = useState(false);
    const [showImpersonateMenu, setShowImpersonateMenu] = useState(false);
    const [impersonateSearch, setImpersonateSearch] = useState('');
    const impersonateSearchRef = useRef<HTMLInputElement>(null);

    // Accordion state for profile and admin submenus.
    // Uses React's "adjust state during render" pattern (prev-value in state) to
    // reset accordion state when the drawer transitions from closed → open,
    // avoiding both useEffect+setState and ref-during-render lint violations.
    const [profileExpanded, setProfileExpanded] = useState(() => location.pathname.startsWith('/profile'));
    const [adminExpanded, setAdminExpanded] = useState(() => location.pathname.startsWith('/admin/settings'));
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) {
            setProfileExpanded(location.pathname.startsWith('/profile'));
            setAdminExpanded(location.pathname.startsWith('/admin/settings'));
            setAvatarError(false);
        }
    }


    // Fetch users for impersonation (admin/operator only)
    const { data: impersonateUsers } = useQuery<{ id: number; username: string; avatar: string | null; discordId: string | null; customAvatarUrl: string | null }[]>({
        queryKey: ['auth', 'users'],
        queryFn: async () => {
            const token = getAuthToken();
            if (!token) return [];
            const res = await fetch(`${API_BASE_URL}/auth/users`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) return [];
            return res.json();
        },
        enabled: isOperatorOrAdmin(user) && !isImpersonating,
        staleTime: 1000 * 60 * 5,
    });

    const handleImpersonate = async (userId: number) => {
        onClose();
        setShowImpersonateMenu(false);
        setImpersonateSearch('');
        await impersonate(userId);
    };

    const handleExitImpersonation = async () => {
        onClose();
        await exitImpersonation();
    };

    // Theme mode icon
    const themeIcon =
        themeMode === 'light' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
        ) : themeMode === 'auto' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
        ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
        );

    const themeLabel =
        themeMode === 'light' ? 'Light mode' : themeMode === 'auto' ? 'Auto (system)' : 'Dark mode';

    return (
        <div
            className={`fixed inset-0 md:hidden ${isOpen ? 'visible' : 'invisible pointer-events-none'}`}
            style={{ zIndex: Z_INDEX.MODAL }}
            aria-hidden={!isOpen}
            data-testid="more-drawer"
        >
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
                aria-hidden="true"
                data-testid="more-drawer-backdrop"
            />

            {/* Drawer panel — full-screen, slides from left */}
            <div
                className={`absolute inset-0 bg-surface flex flex-col transform transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
                style={{ transitionTimingFunction: 'var(--spring-smooth)' }}
                data-testid="more-drawer-panel"
                role="dialog"
                aria-modal="true"
                aria-label="More menu"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-edge-subtle">
                    <span className="text-lg font-semibold text-foreground">More</span>
                    <button
                        onClick={onClose}
                        className="p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel"
                        aria-label="Close menu"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Scrollable content area */}
                <div className="flex-1 overflow-y-auto">

                    {/* User info — profile accordion */}
                    {isAuthenticated && user && (
                        <div className="border-b border-edge-subtle">
                            <button
                                onClick={() => setProfileExpanded((prev) => !prev)}
                                className="flex items-center gap-3 p-4 w-full hover:bg-overlay/20 transition-colors"
                                data-testid="more-drawer-profile-toggle"
                                aria-expanded={profileExpanded}
                                aria-controls="more-drawer-profile-panel"
                            >
                                {avatarUrl && !avatarError ? (
                                    <img
                                        src={avatarUrl}
                                        alt={user.username}
                                        className="w-12 h-12 rounded-full bg-overlay"
                                        onError={() => setAvatarError(true)}
                                    />
                                ) : (
                                    <div className="w-12 h-12 rounded-full bg-overlay flex items-center justify-center text-sm font-semibold text-muted">
                                        {user.username.charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <span className="flex-1 text-left text-foreground font-medium">{user.username}</span>
                                <svg
                                    className={`w-4 h-4 text-muted transition-transform duration-200 ${profileExpanded ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    data-testid="profile-chevron"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {profileExpanded && (
                                <ProfileSubmenuContent pathname={location.pathname} onClose={onClose} />
                            )}
                        </div>
                    )}

                    {/* Admin Settings accordion (admin only) */}
                    {isAdmin(user) && (
                        <div className="border-b border-edge-subtle">
                            <button
                                onClick={() => setAdminExpanded((prev) => !prev)}
                                className="flex items-center gap-3 px-4 py-3 w-full text-foreground hover:bg-overlay/20 transition-colors"
                                data-testid="more-drawer-admin-toggle"
                                aria-expanded={adminExpanded}
                                aria-controls="more-drawer-admin-panel"
                            >
                                <span className="text-2xl w-8 text-center">⚙️</span>
                                <span className="flex-1 text-left font-medium">Admin Settings</span>
                                <svg
                                    className={`w-4 h-4 text-muted transition-transform duration-200 ${adminExpanded ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    data-testid="admin-chevron"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {adminExpanded && (
                                <AdminSubmenuContent pathname={location.pathname} onClose={onClose} />
                            )}
                        </div>
                    )}

                    {/* Controls section */}
                    <div className="px-4 py-4 border-t border-edge-subtle">
                        {/* Theme cycling */}
                        <button
                            onClick={cycleTheme}
                            className="flex items-center gap-3 w-full px-4 py-3 rounded-lg font-medium text-foreground hover:bg-overlay/20 transition-colors"
                            data-testid="more-drawer-theme-toggle"
                        >
                            {themeIcon}
                            <span className="flex-1 text-left">{themeLabel}</span>
                        </button>

                        {/* Send Feedback */}
                        {onFeedbackClick && (
                            <button
                                onClick={() => {
                                    onClose();
                                    onFeedbackClick();
                                }}
                                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg font-medium text-foreground hover:bg-overlay/20 transition-colors"
                                data-testid="more-drawer-feedback"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                </svg>
                                <span className="flex-1 text-left">Send Feedback</span>
                            </button>
                        )}
                    </div>

                    {/* Impersonation section (admin/operator only) */}
                    {isOperatorOrAdmin(user) && !isImpersonating && (
                        <div className="px-4 py-4 border-t border-edge-subtle">
                            <button
                                onClick={() => {
                                    const next = !showImpersonateMenu;
                                    setShowImpersonateMenu(next);
                                    if (!next) setImpersonateSearch('');
                                    else setTimeout(() => impersonateSearchRef.current?.focus(), 0);
                                }}
                                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg font-medium text-foreground hover:bg-overlay/20 transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                <span className="flex-1 text-left">Impersonate</span>
                                <svg
                                    className={`w-4 h-4 text-muted transition-transform ${showImpersonateMenu ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {showImpersonateMenu && (
                                <div className="mt-2 rounded-lg bg-panel/50 overflow-hidden">
                                    <div className="p-3">
                                        <input
                                            ref={impersonateSearchRef}
                                            type="text"
                                            value={impersonateSearch}
                                            onChange={(e) => setImpersonateSearch(e.target.value)}
                                            placeholder="Search users..."
                                            className="w-full px-3 py-2 text-sm bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                        />
                                    </div>
                                    <div className="max-h-48 overflow-y-auto">
                                        {(() => {
                                            const filtered = (impersonateUsers ?? []).filter((u) =>
                                                u.username.toLowerCase().includes(impersonateSearch.toLowerCase())
                                            );
                                            return filtered.length > 0 ? (
                                                filtered.map((u) => {
                                                    const impAvatar = resolveAvatar(toAvatarUser(u));
                                                    return (
                                                        <button
                                                            key={u.id}
                                                            onClick={() => handleImpersonate(u.id)}
                                                            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-muted hover:bg-overlay/30 hover:text-foreground transition-colors"
                                                        >
                                                            {impAvatar.url ? (
                                                                <img
                                                                    src={impAvatar.url}
                                                                    alt={u.username}
                                                                    className="w-6 h-6 rounded-full bg-faint object-cover"
                                                                    onError={(e) => {
                                                                        e.currentTarget.style.display = 'none';
                                                                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                                                    }}
                                                                />
                                                            ) : null}
                                                            <div className={`w-6 h-6 rounded-full bg-faint flex items-center justify-center text-xs font-semibold text-muted ${impAvatar.url ? 'hidden' : ''}`}>
                                                                {u.username.charAt(0).toUpperCase()}
                                                            </div>
                                                            {u.username}
                                                        </button>
                                                    );
                                                })
                                            ) : (
                                                <p className="px-4 py-3 text-xs text-dim">
                                                    {impersonateSearch ? 'No matches' : 'No users available'}
                                                </p>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Exit Impersonation */}
                    {isImpersonating && (
                        <div className="px-4 py-4 border-t border-edge-subtle">
                            <button
                                onClick={handleExitImpersonation}
                                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
                                </svg>
                                <span className="flex-1 text-left">Exit Impersonation</span>
                            </button>
                        </div>
                    )}

                    {/* Logout */}
                    {isAuthenticated && (
                        <div className="px-4 py-6 border-t border-edge-subtle">
                            <button
                                onClick={handleLogout}
                                className="w-full px-4 py-3 bg-red-500/15 text-red-400 font-medium rounded-lg hover:bg-red-500/25 transition-colors"
                                data-testid="more-drawer-logout"
                            >
                                Logout
                            </button>
                        </div>
                    )}
                </div>{/* end scrollable content area */}
            </div>
        </div>
    );
}

/** Profile submenu — renders profile nav sections inline in the MoreDrawer */
function ProfileSubmenuContent({ pathname, onClose }: { pathname: string; onClose: () => void }) {
    const navigate = useNavigate();
    const resetOnboarding = useResetOnboarding();

    const handleRerunWizard = () => {
        resetOnboarding.mutate(undefined, {
            onSuccess: () => {
                onClose();
                navigate('/onboarding?rerun=1');
            },
        });
    };

    return (
        <div id="more-drawer-profile-panel" className="px-4 pb-3 space-y-3" data-testid="profile-submenu">
            {PROFILE_SECTIONS.map((section) => (
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
 * Admin submenu — conditionally rendered so hooks only fire when expanded.
 * Uses the same builder functions and SidebarNavItem from admin-sidebar.
 */
function AdminSubmenuContent({ pathname, onClose }: { pathname: string; onClose: () => void }) {
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

    return (
        <div id="more-drawer-admin-panel" className="px-4 pb-3 space-y-3" data-testid="admin-submenu">
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
