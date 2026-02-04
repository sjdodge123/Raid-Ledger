import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { API_BASE_URL } from '../../lib/config';

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
        { to: '/', label: 'Home' },
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
                    ) : (
                        <a
                            href={`${API_BASE_URL}/auth/discord`}
                            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                            </svg>
                            Login with Discord
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}

