import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { useThemeStore } from '../../stores/theme-store';
import { API_BASE_URL } from '../../lib/config';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import { DiscordIcon } from '../icons/DiscordIcon';

interface MobileNavProps {
    isOpen: boolean;
    onClose: () => void;
}

/** Returns true if `pathname` matches `to` (exact for /, prefix for others). */
function isActive(pathname: string, to: string): boolean {
    if (to === '/') return pathname === '/';
    return pathname === to || pathname.startsWith(to + '/');
}

/**
 * Mobile slide-out navigation drawer.
 */
export function MobileNav({ isOpen, onClose }: MobileNavProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, isAuthenticated, logout } = useAuth();
    const { data: systemStatus } = useSystemStatus();
    const themeMode = useThemeStore((s) => s.themeMode);
    const cycleTheme = useThemeStore((s) => s.cycleTheme);

    const discordConfigured = systemStatus?.discordConfigured ?? false;

    // Close on route change (but not on initial mount)
    const prevPathRef = useRef(location.pathname);
    useEffect(() => {
        if (prevPathRef.current !== location.pathname) {
            prevPathRef.current = location.pathname;
            onClose();
        }
    }, [location.pathname, onClose]);

    // Close on Escape key and lock body scroll while open
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

    // ROK-222: Use resolveAvatar for unified avatar resolution
    const avatarResolved = user ? resolveAvatar(toAvatarUser(user)) : null;
    const avatarUrl = avatarResolved?.url;

    const navLinks = [
        { to: '/calendar', label: 'Calendar' },
        { to: '/games', label: 'Games' },
        { to: '/events', label: 'Events' },
        ...(isAuthenticated ? [{ to: '/my-events', label: 'My Events' }] : []),
        { to: '/players', label: 'Players' },
    ];

    const activeLinkClass = 'bg-emerald-600/20 text-emerald-400';
    const inactiveLinkClass = 'text-secondary hover:bg-panel hover:text-foreground';

    return (
        <div
            className={`fixed inset-0 z-50 md:hidden ${isOpen ? 'visible' : 'invisible pointer-events-none'}`}
            aria-hidden={!isOpen}
        >
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Drawer */}
            <div
                className={`absolute top-0 right-0 w-72 h-full bg-surface border-l border-edge-subtle shadow-2xl transform transition-transform duration-200 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-edge-subtle">
                    <span className="text-lg font-semibold text-foreground">Menu</span>
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

                {/* User info */}
                {isAuthenticated && user && (
                    <div className="p-4 border-b border-edge-subtle">
                        <div className="flex items-center gap-3">
                            {avatarUrl ? (
                                <img
                                    src={avatarUrl}
                                    alt={user.username}
                                    className="w-10 h-10 rounded-full bg-overlay"
                                    onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                    }}
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-sm font-semibold text-muted">
                                    {user.username.charAt(0).toUpperCase()}
                                </div>
                            )}
                            <span className="text-foreground font-medium">{user.username}</span>
                        </div>
                    </div>
                )}

                {/* Navigation links */}
                <nav className="p-4 space-y-1 overflow-y-auto" style={{ maxHeight: 'calc(100% - 10rem)' }}>
                    {navLinks.map(({ to, label }) => (
                        <Link
                            key={to}
                            to={to}
                            className={`block px-4 py-3 rounded-lg font-medium transition-colors ${isActive(location.pathname, to) ? activeLinkClass : inactiveLinkClass}`}
                        >
                            {label}
                        </Link>
                    ))}

                    {isAuthenticated && (
                        <Link
                            to="/profile"
                            className={`block px-4 py-3 rounded-lg font-medium transition-colors ${isActive(location.pathname, '/profile') ? activeLinkClass : inactiveLinkClass}`}
                        >
                            Profile
                        </Link>
                    )}

                    {isAdmin(user) && (
                        <Link
                            to="/admin/settings"
                            className={`block px-4 py-3 rounded-lg font-medium transition-colors ${isActive(location.pathname, '/admin') ? activeLinkClass : inactiveLinkClass}`}
                        >
                            Admin Settings
                        </Link>
                    )}

                    {/* Theme toggle -- cycles mode: dark -> light -> auto */}
                    <button
                        onClick={cycleTheme}
                        className="flex items-center gap-3 w-full px-4 py-3 rounded-lg font-medium text-secondary hover:bg-panel hover:text-foreground transition-colors"
                    >
                        {themeMode === 'light' ? (
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
                        )}
                        {themeMode === 'light' ? 'Light mode' : themeMode === 'auto' ? 'Auto (system)' : 'Dark mode'}
                    </button>
                </nav>

                {/* Auth action */}
                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-edge-subtle">
                    {isAuthenticated ? (
                        <button
                            onClick={handleLogout}
                            className="block w-full text-center px-4 py-3 bg-panel hover:bg-overlay text-secondary font-medium rounded-lg transition-colors"
                        >
                            Logout
                        </button>
                    ) : discordConfigured ? (
                        <a
                            href={`${API_BASE_URL}/auth/discord`}
                            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-foreground font-medium rounded-lg transition-colors"
                        >
                            <DiscordIcon className="w-5 h-5" />
                            Login with Discord
                        </a>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
