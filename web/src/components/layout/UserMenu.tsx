import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { API_BASE_URL } from '../../lib/config';
import { resolveAvatar, toAvatarUser, buildDiscordAvatarUrl } from '../../lib/avatar';
import { DiscordIcon } from '../icons/DiscordIcon';
import { useQuery } from '@tanstack/react-query';
import { getAuthToken } from '../../hooks/use-auth';
import { RoleBadge } from '../ui/role-badge';

interface ImpersonateUser {
    id: number;
    username: string;
    avatar: string | null;
}

/**
 * User menu dropdown showing avatar, username, and actions.
 * Includes admin impersonation dropdown (ROK-212).
 * ROK-222: Uses resolveAvatar() for unified avatar resolution.
 */
export function UserMenu() {
    const { user, isAuthenticated, isImpersonating, logout, impersonate, exitImpersonation } = useAuth();
    const { data: systemStatus } = useSystemStatus();
    const [isOpen, setIsOpen] = useState(false);
    const [showImpersonateMenu, setShowImpersonateMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    const discordConfigured = systemStatus?.discordConfigured ?? false;

    // Fetch users for impersonation dropdown (admin-only)
    const { data: impersonateUsers } = useQuery<ImpersonateUser[]>({
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
        enabled: isAdmin(user) && !isImpersonating,
        staleTime: 1000 * 60 * 5,
    });

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setShowImpersonateMenu(false);
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
                setShowImpersonateMenu(false);
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

    const handleImpersonate = async (userId: number) => {
        setIsOpen(false);
        setShowImpersonateMenu(false);
        await impersonate(userId);
    };

    const handleExitImpersonation = async () => {
        setIsOpen(false);
        await exitImpersonation();
    };

    // Show Discord login button only if Discord is configured
    if (!isAuthenticated || !user) {
        if (!discordConfigured) {
            return null; // Don't show anything in header if Discord isn't configured
        }
        return (
            <a
                href={`${API_BASE_URL}/auth/discord`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-foreground font-medium rounded-lg transition-colors"
            >
                <DiscordIcon className="w-5 h-5" />
                Login with Discord
            </a>
        );
    }

    // ROK-222: Use resolveAvatar for unified avatar resolution
    const resolved = resolveAvatar(toAvatarUser(user));
    const avatarUrl = resolved.url;

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 p-1 rounded-lg hover:bg-panel transition-colors"
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt={user.username}
                        className="w-8 h-8 rounded-full bg-overlay"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <div className="w-8 h-8 rounded-full bg-overlay flex items-center justify-center text-xs font-semibold text-muted">
                        {user.username.charAt(0).toUpperCase()}
                    </div>
                )}
                <span className="text-foreground font-medium hidden sm:block">
                    {user.username}
                </span>
                <svg
                    className={`w-4 h-4 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-surface border border-edge rounded-lg shadow-xl z-50">
                    <div className="p-3 border-b border-edge">
                        <div className="flex items-center gap-2">
                            <p className="text-foreground font-medium">{user.username}</p>
                            <RoleBadge role={user.role} />
                        </div>
                        {isImpersonating && (
                            <p className="text-amber-400 text-xs mt-1">Impersonating</p>
                        )}
                    </div>
                    <div className="py-1">
                        {/* Exit impersonation (shown when impersonating) */}
                        {isImpersonating && (
                            <button
                                onClick={handleExitImpersonation}
                                className="flex items-center gap-2 w-full text-left px-4 py-2 text-amber-400 hover:bg-panel transition-colors font-medium"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
                                </svg>
                                Exit Impersonation
                            </button>
                        )}

                        <Link
                            to="/profile"
                            className="block px-4 py-2 text-secondary hover:bg-panel hover:text-foreground transition-colors"
                            onClick={() => setIsOpen(false)}
                        >
                            Profile
                        </Link>

                        {isAdmin(user) && !isImpersonating && (
                            <>
                                <Link
                                    to="/admin/settings"
                                    className="flex items-center gap-2 px-4 py-2 text-secondary hover:bg-panel hover:text-foreground transition-colors"
                                    onClick={() => setIsOpen(false)}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    Plugins
                                </Link>

                                {/* Impersonation dropdown */}
                                <div className="border-t border-edge mt-1 pt-1">
                                    <button
                                        onClick={() => setShowImpersonateMenu(!showImpersonateMenu)}
                                        className="flex items-center justify-between w-full px-4 py-2 text-secondary hover:bg-panel hover:text-foreground transition-colors"
                                    >
                                        <span className="flex items-center gap-2">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                            Impersonate
                                        </span>
                                        <svg
                                            className={`w-3 h-3 transition-transform ${showImpersonateMenu ? 'rotate-180' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>

                                    {showImpersonateMenu && (
                                        <div className="max-h-48 overflow-y-auto bg-panel/50">
                                            {impersonateUsers && impersonateUsers.length > 0 ? (
                                                impersonateUsers.map((u) => {
                                                    const impAvatar = buildDiscordAvatarUrl(String(u.id), u.avatar);
                                                    return (
                                                        <button
                                                            key={u.id}
                                                            onClick={() => handleImpersonate(u.id)}
                                                            className="flex items-center gap-2 w-full px-6 py-1.5 text-sm text-muted hover:bg-overlay hover:text-foreground transition-colors"
                                                        >
                                                            {impAvatar ? (
                                                                <img
                                                                    src={impAvatar}
                                                                    alt={u.username}
                                                                    className="w-5 h-5 rounded-full bg-faint"
                                                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                                />
                                                            ) : (
                                                                <div className="w-5 h-5 rounded-full bg-faint flex items-center justify-center text-[10px] font-semibold text-muted">
                                                                    {u.username.charAt(0).toUpperCase()}
                                                                </div>
                                                            )}
                                                            {u.username}
                                                        </button>
                                                    );
                                                })
                                            ) : (
                                                <p className="px-6 py-2 text-xs text-dim">No users available</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        <button
                            onClick={handleLogout}
                            className="block w-full text-left px-4 py-2 text-secondary hover:bg-panel hover:text-foreground transition-colors"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
