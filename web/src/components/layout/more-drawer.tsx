import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin, isOperatorOrAdmin } from '../../hooks/use-auth';
import { useThemeStore } from '../../stores/theme-store';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import { Z_INDEX } from '../../lib/z-index';
import { useQuery } from '@tanstack/react-query';
import { getAuthToken } from '../../hooks/use-auth';
import { API_BASE_URL } from '../../lib/config';
import { useFocusTrap } from '../../hooks/use-focus-trap';
import { ProfileSubmenuContent, AdminSubmenuContent } from './more-drawer-submenus';
import { ImpersonateSection } from './more-drawer-impersonate';

interface MoreDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onFeedbackClick?: () => void;
}

type ImpersonateUser = { id: number; username: string; avatar: string | null; discordId: string | null; customAvatarUrl: string | null };

function useCloseOnRouteChange(pathname: string, onClose: () => void) {
    const prevPathRef = useRef(pathname);
    useEffect(() => {
        if (prevPathRef.current !== pathname) { prevPathRef.current = pathname; onClose(); }
    }, [pathname, onClose]);
}

function useDrawerKeyboardAndScroll(isOpen: boolean, onClose: () => void) {
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        if (isOpen) { document.addEventListener('keydown', handleEscape); document.body.style.overflow = 'hidden'; }
        return () => { document.removeEventListener('keydown', handleEscape); document.body.style.overflow = ''; };
    }, [isOpen, onClose]);
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

function DrawerHeader({ onClose }: { onClose: () => void }) {
    return (
        <div className="flex items-center justify-between p-4 border-b border-edge-subtle">
            <span className="text-lg font-semibold text-foreground">More</span>
            <button onClick={onClose} className="p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel" aria-label="Close menu">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
}

function UserProfileAccordion({ user, avatarUrl, avatarError, onAvatarError, expanded, onToggle, pathname, onClose }: {
    user: { username: string }; avatarUrl: string | null; avatarError: boolean;
    onAvatarError: () => void; expanded: boolean; onToggle: () => void; pathname: string; onClose: () => void;
}) {
    return (
        <div className="border-b border-edge-subtle">
            <button onClick={onToggle} className="flex items-center gap-3 p-4 w-full hover:bg-overlay/20 transition-colors"
                data-testid="more-drawer-profile-toggle" aria-expanded={expanded}>
                {avatarUrl && !avatarError
                    ? <img src={avatarUrl} alt={user.username} className="w-12 h-12 rounded-full bg-overlay" onError={onAvatarError} />
                    : <div className="w-12 h-12 rounded-full bg-overlay flex items-center justify-center text-sm font-semibold text-muted">{user.username.charAt(0).toUpperCase()}</div>}
                <span className="flex-1 text-left text-foreground font-medium">{user.username}</span>
                <svg className={`w-4 h-4 text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24" data-testid="profile-chevron">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {expanded && <ProfileSubmenuContent pathname={pathname} onClose={onClose} />}
        </div>
    );
}

function AdminAccordion({ expanded, onToggle, pathname, onClose }: {
    expanded: boolean; onToggle: () => void; pathname: string; onClose: () => void;
}) {
    return (
        <div className="border-b border-edge-subtle">
            <button onClick={onToggle} className="flex items-center gap-3 px-4 py-3 w-full text-foreground hover:bg-overlay/20 transition-colors"
                data-testid="more-drawer-admin-toggle" aria-expanded={expanded}>
                <span className="text-2xl w-8 text-center">{'\u2699\uFE0F'}</span>
                <span className="flex-1 text-left font-medium">Admin Settings</span>
                <svg className={`w-4 h-4 text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24" data-testid="admin-chevron">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {expanded && <AdminSubmenuContent pathname={pathname} onClose={onClose} />}
        </div>
    );
}

function ThemeIcon({ mode }: { mode: string }) {
    if (mode === 'light') return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
    if (mode === 'auto') return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
    return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>;
}

function themeLabel(mode: string) {
    if (mode === 'light') return 'Light mode';
    if (mode === 'auto') return 'Auto (system)';
    return 'Dark mode';
}

function ControlsSection({ onFeedbackClick, onClose }: { onFeedbackClick?: () => void; onClose: () => void }) {
    const themeMode = useThemeStore((s) => s.themeMode);
    const cycleTheme = useThemeStore((s) => s.cycleTheme);
    return (
        <div className="px-4 py-4 border-t border-edge-subtle">
            <button onClick={cycleTheme} className="flex items-center gap-3 w-full px-4 py-3 rounded-lg font-medium text-foreground hover:bg-overlay/20 transition-colors" data-testid="more-drawer-theme-toggle">
                <ThemeIcon mode={themeMode} />
                <span className="flex-1 text-left">{themeLabel(themeMode)}</span>
            </button>
            {onFeedbackClick && (
                <button onClick={() => { onClose(); onFeedbackClick(); }}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-lg font-medium text-foreground hover:bg-overlay/20 transition-colors" data-testid="more-drawer-feedback">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    <span className="flex-1 text-left">Send Feedback</span>
                </button>
            )}
        </div>
    );
}

function ExitImpersonationButton({ onExit }: { onExit: () => void }) {
    return (
        <div className="px-4 py-4 border-t border-edge-subtle">
            <button onClick={onExit} className="flex items-center gap-3 w-full px-4 py-3 rounded-lg font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
                </svg>
                <span className="flex-1 text-left">Exit Impersonation</span>
            </button>
        </div>
    );
}

function useDrawerAccordionState(isOpen: boolean, pathname: string) {
    const [profileExpanded, setProfileExpanded] = useState(() => pathname.startsWith('/profile'));
    const [adminExpanded, setAdminExpanded] = useState(() => pathname.startsWith('/admin/settings'));
    const [avatarError, setAvatarError] = useState(false);
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) {
            setProfileExpanded(pathname.startsWith('/profile'));
            setAdminExpanded(pathname.startsWith('/admin/settings'));
            setAvatarError(false);
        }
    }

    return { profileExpanded, setProfileExpanded, adminExpanded, setAdminExpanded, avatarError, setAvatarError };
}

/**
 * Full-screen mobile "More" drawer (ROK-332).
 * Replaces the 288px MobileNav with a full-screen left-sliding panel
 * featuring avatar, navigation, theme cycling, and logout.
 */
function useMoreDrawerState(isOpen: boolean, onClose: () => void) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, isAuthenticated, isImpersonating, logout, impersonate, exitImpersonation } = useAuth();
    const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
    useCloseOnRouteChange(location.pathname, onClose);
    useDrawerKeyboardAndScroll(isOpen, onClose);
    const { data: impersonateUsers } = useImpersonateUsers(user, isImpersonating);
    const accordion = useDrawerAccordionState(isOpen, location.pathname);
    const avatarUrl = user ? resolveAvatar(toAvatarUser(user)).url : null;
    const handleLogout = () => { logout(); onClose(); navigate('/', { replace: true }); };
    const handleImpersonate = async (userId: number) => { onClose(); await impersonate(userId); };
    const handleExitImpersonation = async () => { onClose(); await exitImpersonation(); };
    return { location, user, isAuthenticated, isImpersonating, trapRef, impersonateUsers, accordion, avatarUrl, handleLogout, handleImpersonate, handleExitImpersonation };
}

export function MoreDrawer({ isOpen, onClose, onFeedbackClick }: MoreDrawerProps) {
    const { trapRef, ...s } = useMoreDrawerState(isOpen, onClose);
    return (
        <div className={`fixed inset-0 md:hidden ${isOpen ? 'visible' : 'invisible pointer-events-none'}`}
            style={{ zIndex: Z_INDEX.MODAL }} aria-hidden={!isOpen} data-testid="more-drawer">
            <div className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose} aria-hidden="true" data-testid="more-drawer-backdrop" />
            <div ref={trapRef} className={`absolute inset-0 bg-surface flex flex-col transform transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
                style={{ transitionTimingFunction: 'var(--spring-smooth)' }} data-testid="more-drawer-panel" role="dialog" aria-modal="true" aria-label="More menu">
                <DrawerHeader onClose={onClose} />
                <MoreDrawerBody s={s} onClose={onClose} onFeedbackClick={onFeedbackClick} />
            </div>
        </div>
    );
}

function MoreDrawerBody({ s, onClose, onFeedbackClick }: { s: Omit<ReturnType<typeof useMoreDrawerState>, 'trapRef'>; onClose: () => void; onFeedbackClick?: () => void }) {
    return (
        <div className="flex-1 overflow-y-auto">
            {s.isAuthenticated && s.user && (
                <UserProfileAccordion user={s.user} avatarUrl={s.avatarUrl} avatarError={s.accordion.avatarError}
                    onAvatarError={() => s.accordion.setAvatarError(true)} expanded={s.accordion.profileExpanded}
                    onToggle={() => s.accordion.setProfileExpanded(p => !p)} pathname={s.location.pathname} onClose={onClose} />
            )}
            {isAdmin(s.user) && (
                <AdminAccordion expanded={s.accordion.adminExpanded} onToggle={() => s.accordion.setAdminExpanded(p => !p)} pathname={s.location.pathname} onClose={onClose} />
            )}
            <ControlsSection onFeedbackClick={onFeedbackClick} onClose={onClose} />
            {isOperatorOrAdmin(s.user) && !s.isImpersonating && <ImpersonateSection impersonateUsers={s.impersonateUsers} onImpersonate={s.handleImpersonate} />}
            {s.isImpersonating && <ExitImpersonationButton onExit={s.handleExitImpersonation} />}
            {s.isAuthenticated && (
                <div className="px-4 py-6 border-t border-edge-subtle">
                    <button onClick={s.handleLogout} className="w-full px-4 py-3 bg-red-500/15 text-red-400 font-medium rounded-lg hover:bg-red-500/25 transition-colors" data-testid="more-drawer-logout">Logout</button>
                </div>
            )}
        </div>
    );
}
