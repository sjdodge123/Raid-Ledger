import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin, isOperatorOrAdmin } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { API_BASE_URL } from '../../lib/config';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import { DiscordIcon } from '../icons/DiscordIcon';
import { useQuery } from '@tanstack/react-query';
import { getAuthToken } from '../../hooks/use-auth';
import { RoleBadge } from '../ui/role-badge';
import { useFocusTrap } from '../../hooks/use-focus-trap';

interface ImpersonateUser {
    id: number;
    username: string;
    avatar: string | null;
    discordId: string | null;
    customAvatarUrl: string | null;
}

function useImpersonateUsers(user: ReturnType<typeof useAuth>['user'], isImpersonating: boolean) {
    return useQuery<ImpersonateUser[]>({
        queryKey: ['auth', 'users'],
        queryFn: async () => {
            const token = getAuthToken();
            if (!token) return [];
            const res = await fetch(`${API_BASE_URL}/auth/users`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) return [];
            return res.json();
        },
        enabled: isOperatorOrAdmin(user) && !isImpersonating,
        staleTime: 1000 * 60 * 5,
    });
}

function useCloseOnClickOutside(menuRef: React.RefObject<HTMLDivElement | null>, isOpen: boolean, closeMenu: () => void) {
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeMenu();
        }
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, closeMenu, menuRef]);
}

function useCloseOnEscape(isOpen: boolean, closeMenu: () => void) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
        if (isOpen) document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, closeMenu]);
}

function AvatarButton({ avatarUrl, username, isOpen, onClick }: {
    avatarUrl: string | null; username: string; isOpen: boolean; onClick: () => void;
}) {
    return (
        <button onClick={onClick} className="flex items-center gap-2 px-2 min-h-[44px] rounded-lg hover:bg-panel transition-colors"
            aria-expanded={isOpen} aria-haspopup="true">
            {avatarUrl
                ? <img src={avatarUrl} alt={username} className="w-8 h-8 rounded-full bg-overlay" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                : <div className="w-8 h-8 rounded-full bg-overlay flex items-center justify-center text-xs font-semibold text-muted">{username.charAt(0).toUpperCase()}</div>}
            <span className="text-foreground font-medium hidden sm:block">{username}</span>
            <svg className={`w-4 h-4 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
        </button>
    );
}

function ProfileLink({ username, role, isImpersonating, onClose }: {
    username: string; role: string; isImpersonating: boolean; onClose: () => void;
}) {
    return (
        <Link to="/profile" className="block p-3 border-b border-edge hover:bg-panel/50 transition-colors" onClick={onClose}>
            <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="text-foreground font-medium">{username}</p>
                        <RoleBadge role={role} />
                    </div>
                    {isImpersonating
                        ? <p className="text-amber-400 text-xs mt-0.5">Impersonating</p>
                        : <p className="text-xs text-muted mt-0.5">View Profile</p>}
                </div>
                <svg className="w-4 h-4 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
            </div>
        </Link>
    );
}

function ExitImpersonationItem({ onExit }: { onExit: () => void }) {
    return (
        <button onClick={onExit} className="flex items-center gap-2 w-full text-left px-4 py-2 text-amber-400 hover:bg-panel transition-colors font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
            </svg>
            Exit Impersonation
        </button>
    );
}

function AdminSettingsLink({ onClose }: { onClose: () => void }) {
    return (
        <Link to="/admin/settings" className="flex items-center gap-2 px-4 py-2 text-secondary hover:bg-panel hover:text-foreground transition-colors" onClick={onClose}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Admin Settings
        </Link>
    );
}

function ImpersonateUserItem({ user, onSelect }: { user: ImpersonateUser; onSelect: (id: number) => void }) {
    const impAvatar = resolveAvatar(toAvatarUser(user));
    return (
        <button onClick={() => onSelect(user.id)} className="flex items-center gap-2 w-full px-6 py-1.5 text-sm text-muted hover:bg-overlay hover:text-foreground transition-colors">
            {impAvatar.url
                ? <img src={impAvatar.url} alt={user.username} className="w-5 h-5 rounded-full bg-faint object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />
                : null}
            <div className={`w-5 h-5 rounded-full bg-faint flex items-center justify-center text-[10px] font-semibold text-muted ${impAvatar.url ? 'hidden' : ''}`}>
                {user.username.charAt(0).toUpperCase()}
            </div>
            {user.username}
        </button>
    );
}

function ImpersonateDropdown({ users, search, onSearch, onSelect, searchRef }: {
    users: ImpersonateUser[]; search: string; onSearch: (v: string) => void;
    onSelect: (id: number) => void; searchRef: React.RefObject<HTMLInputElement | null>;
}) {
    const filtered = users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase()));
    return (
        <div className="bg-panel/50">
            <div className="px-3 py-1.5">
                <input ref={searchRef} type="text" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search users..."
                    className="w-full px-2.5 py-1 text-xs bg-surface/50 border border-edge rounded text-foreground placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-transparent"
                    onClick={(e) => e.stopPropagation()} />
            </div>
            <div className="max-h-48 overflow-y-auto">
                {filtered.length > 0
                    ? filtered.map((u) => <ImpersonateUserItem key={u.id} user={u} onSelect={onSelect} />)
                    : <p className="px-6 py-2 text-xs text-dim">{search ? 'No matches' : 'No users available'}</p>}
            </div>
        </div>
    );
}

function ImpersonateSection({ showMenu, onToggle, users, search, onSearch, onSelect, searchRef }: {
    showMenu: boolean; onToggle: () => void; users: ImpersonateUser[];
    search: string; onSearch: (v: string) => void; onSelect: (id: number) => void;
    searchRef: React.RefObject<HTMLInputElement | null>;
}) {
    return (
        <div className="border-t border-edge mt-1 pt-1">
            <button onClick={onToggle} className="flex items-center justify-between w-full px-4 py-2 text-secondary hover:bg-panel hover:text-foreground transition-colors">
                <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Impersonate
                </span>
                <svg className={`w-3 h-3 transition-transform ${showMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {showMenu && <ImpersonateDropdown users={users} search={search} onSearch={onSearch} onSelect={onSelect} searchRef={searchRef} />}
        </div>
    );
}

function DropdownContent({ user, isImpersonating, onClose, onLogout, onExitImpersonation, onImpersonate, impersonateUsers, trapRef }: {
    user: { username: string; role: string }; isImpersonating: boolean; onClose: () => void;
    onLogout: () => void; onExitImpersonation: () => void; onImpersonate: (id: number) => void;
    impersonateUsers: ImpersonateUser[] | undefined; trapRef: React.RefObject<HTMLDivElement | null>;
}) {
    const [showImpersonateMenu, setShowImpersonateMenu] = useState(false);
    const [impersonateSearch, setImpersonateSearch] = useState('');
    const impersonateSearchRef = useRef<HTMLInputElement>(null);

    const toggleImpersonate = () => {
        const next = !showImpersonateMenu; setShowImpersonateMenu(next);
        if (!next) setImpersonateSearch(''); else setTimeout(() => impersonateSearchRef.current?.focus(), 0);
    };

    return (
        <div ref={trapRef} role="menu" className="absolute right-0 mt-2 w-56 bg-surface border border-edge rounded-lg shadow-xl z-50">
            <ProfileLink username={user.username} role={user.role} isImpersonating={isImpersonating} onClose={onClose} />
            <div className="py-1">
                {isImpersonating && <ExitImpersonationItem onExit={onExitImpersonation} />}
                {isAdmin(user) && !isImpersonating && <AdminSettingsLink onClose={onClose} />}
                {isOperatorOrAdmin(user) && !isImpersonating && (
                    <ImpersonateSection showMenu={showImpersonateMenu} onToggle={toggleImpersonate}
                        users={impersonateUsers ?? []} search={impersonateSearch} onSearch={setImpersonateSearch}
                        onSelect={onImpersonate} searchRef={impersonateSearchRef} />
                )}
                <button onClick={onLogout} className="block w-full text-left px-4 py-2 text-secondary hover:bg-panel hover:text-foreground transition-colors">Logout</button>
            </div>
        </div>
    );
}

/**
 * User menu dropdown showing avatar, username, and actions.
 * Includes admin impersonation dropdown (ROK-212).
 * ROK-222: Uses resolveAvatar() for unified avatar resolution.
 */
function useUserMenuState() {
    const { user, isAuthenticated, isImpersonating, logout, impersonate, exitImpersonation } = useAuth();
    const { data: systemStatus } = useSystemStatus();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
    const closeMenu = useCallback(() => { setIsOpen(false); }, []);
    useCloseOnClickOutside(menuRef, isOpen, closeMenu);
    useCloseOnEscape(isOpen, closeMenu);
    const { data: impersonateUsers } = useImpersonateUsers(user, isImpersonating);
    const handleLogout = () => { logout(); setIsOpen(false); navigate('/', { replace: true }); };
    const handleImpersonate = async (userId: number) => { setIsOpen(false); await impersonate(userId); };
    const handleExitImpersonation = async () => { setIsOpen(false); await exitImpersonation(); };
    return { user, isAuthenticated, isImpersonating, isOpen, setIsOpen, menuRef, trapRef, closeMenu, impersonateUsers, discordConfigured: systemStatus?.discordConfigured ?? false, handleLogout, handleImpersonate, handleExitImpersonation };
}

export function UserMenu() {
    const s = useUserMenuState();
    if (!s.isAuthenticated || !s.user) {
        if (!s.discordConfigured) return null;
        return (
            <a href={`${API_BASE_URL}/auth/discord`} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-foreground font-medium rounded-lg transition-colors">
                <DiscordIcon className="w-5 h-5" />Login with Discord
            </a>
        );
    }
    const avatarUrl = resolveAvatar(toAvatarUser(s.user)).url;
    return (
        <div className="relative" ref={s.menuRef}>
            <AvatarButton avatarUrl={avatarUrl} username={s.user.username} isOpen={s.isOpen} onClick={() => s.setIsOpen(!s.isOpen)} />
            {s.isOpen && (
                <DropdownContent user={s.user} isImpersonating={s.isImpersonating} onClose={s.closeMenu}
                    onLogout={s.handleLogout} onExitImpersonation={s.handleExitImpersonation}
                    onImpersonate={s.handleImpersonate} impersonateUsers={s.impersonateUsers} trapRef={s.trapRef} />
            )}
        </div>
    );
}
