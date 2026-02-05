import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { API_BASE_URL } from '../../lib/config';
import { DiscordIcon } from '../icons/DiscordIcon';

/**
 * User menu dropdown showing avatar, username, and actions.
 */
export function UserMenu() {
    const { user, isAuthenticated, logout } = useAuth();
    const { data: systemStatus } = useSystemStatus();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    const discordConfigured = systemStatus?.discordConfigured ?? false;

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Close on Escape key
    useEffect(() => {
        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
        }
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen]);

    const handleLogout = () => {
        logout();
        setIsOpen(false);
        navigate('/', { replace: true });
    };

    // Show Discord login button only if Discord is configured
    if (!isAuthenticated || !user) {
        if (!discordConfigured) {
            return null; // Don't show anything in header if Discord isn't configured
        }
        return (
            <a
                href={`${API_BASE_URL}/auth/discord`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors"
            >
                <DiscordIcon className="w-5 h-5" />
                Login with Discord
            </a>
        );
    }

    // Only use Discord CDN if user has both discordId AND avatar hash
    const avatarUrl = user.discordId && user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`
        : '/default-avatar.png';

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-800 transition-colors"
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                <img
                    src={avatarUrl}
                    alt={user.username}
                    className="w-8 h-8 rounded-full bg-slate-700"
                    onError={(e) => {
                        e.currentTarget.src = '/default-avatar.png';
                    }}
                />
                <span className="text-white font-medium hidden sm:block">
                    {user.username}
                </span>
                <svg
                    className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50">
                    <div className="p-3 border-b border-slate-700">
                        <p className="text-white font-medium">{user.username}</p>
                    </div>
                    <div className="py-1">
                        <Link
                            to="/profile"
                            className="block px-4 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                            onClick={() => setIsOpen(false)}
                        >
                            Profile
                        </Link>
                        <button
                            onClick={handleLogout}
                            className="block w-full text-left px-4 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
