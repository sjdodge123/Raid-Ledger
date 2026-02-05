import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { API_BASE_URL } from '../../lib/config';
import { DiscordIcon } from '../icons/DiscordIcon';

interface MobileNavProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Mobile slide-out navigation drawer.
 */
export function MobileNav({ isOpen, onClose }: MobileNavProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, isAuthenticated, logout } = useAuth();
    const { data: systemStatus } = useSystemStatus();

    const discordConfigured = systemStatus?.discordConfigured ?? false;

    // Close on route change
    useEffect(() => {
        onClose();
    }, [location.pathname, onClose]);

    // Close on Escape key
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

    if (!isOpen) return null;

    const avatarUrl = user?.avatar
        ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`
        : '/default-avatar.png';

    const navLinks = [
        { to: '/events', label: 'Events' },
    ];

    return (
        <div className="fixed inset-0 z-50 md:hidden">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Drawer */}
            <div className="absolute top-0 right-0 w-72 h-full bg-slate-900 border-l border-slate-800 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <span className="text-lg font-semibold text-white">Menu</span>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
                        aria-label="Close menu"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* User info */}
                {isAuthenticated && user && (
                    <div className="p-4 border-b border-slate-800">
                        <div className="flex items-center gap-3">
                            <img
                                src={avatarUrl}
                                alt={user.username}
                                className="w-10 h-10 rounded-full bg-slate-700"
                                onError={(e) => {
                                    e.currentTarget.src = '/default-avatar.png';
                                }}
                            />
                            <span className="text-white font-medium">{user.username}</span>
                        </div>
                    </div>
                )}

                {/* Navigation links */}
                <nav className="p-4 space-y-1">
                    {navLinks.map(({ to, label }) => (
                        <Link
                            key={to}
                            to={to}
                            className={`block px-4 py-3 rounded-lg font-medium transition-colors ${location.pathname === to
                                ? 'bg-emerald-600/20 text-emerald-400'
                                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                }`}
                        >
                            {label}
                        </Link>
                    ))}

                    {isAuthenticated && (
                        <Link
                            to="/profile"
                            className={`block px-4 py-3 rounded-lg font-medium transition-colors ${location.pathname === '/profile'
                                ? 'bg-emerald-600/20 text-emerald-400'
                                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                }`}
                        >
                            Profile
                        </Link>
                    )}
                </nav>

                {/* Auth action */}
                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800">
                    {isAuthenticated ? (
                        <button
                            onClick={handleLogout}
                            className="block w-full text-center px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition-colors"
                        >
                            Logout
                        </button>
                    ) : discordConfigured ? (
                        <a
                            href={`${API_BASE_URL}/auth/discord`}
                            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors"
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

