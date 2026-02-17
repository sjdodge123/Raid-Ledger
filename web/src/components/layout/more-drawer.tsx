import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin, isOperatorOrAdmin } from '../../hooks/use-auth';
import { useThemeStore } from '../../stores/theme-store';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import { Z_INDEX } from '../../lib/z-index';
import { useQuery } from '@tanstack/react-query';
import { getAuthToken } from '../../hooks/use-auth';
import { API_BASE_URL } from '../../lib/config';

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

    const navLinks = [
        ...(isAdmin(user)
            ? [{ to: '/admin/settings', icon: '⚙️', label: 'Admin Settings' }]
            : []),
    ];

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
                className={`absolute inset-0 bg-surface transform transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
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

                {/* User info — taps through to Profile */}
                {isAuthenticated && user && (
                    <Link
                        to="/profile"
                        onClick={onClose}
                        className="flex items-center gap-3 p-4 border-b border-edge-subtle hover:bg-overlay/20 transition-colors"
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
                        <span className="flex-1 text-foreground font-medium">{user.username}</span>
                        <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </Link>
                )}

                {navLinks.length > 0 && (
                    <nav className="py-4" data-testid="more-drawer-nav">
                        {navLinks.map(({ to, icon, label }) => (
                            <Link
                                key={to}
                                to={to}
                                onClick={onClose}
                                className="flex items-center gap-3 px-4 py-3 text-foreground hover:bg-overlay/20 transition-colors"
                            >
                                <span className="text-2xl w-8 text-center">{icon}</span>
                                <span className="flex-1 font-medium">{label}</span>
                                <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </Link>
                        ))}
                    </nav>
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
            </div>
        </div>
    );
}
