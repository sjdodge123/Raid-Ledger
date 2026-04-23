import { Link, useLocation } from 'react-router-dom';
import { UserMenu } from './UserMenu';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from '../notifications';
import { useAuth, type User } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { API_BASE_URL } from '../../lib/config';
import { Z_INDEX } from '../../lib/z-index';

interface HeaderProps {
    /** Called when the mobile hamburger button is tapped. */
    onMenuClick: () => void;
}

/**
 * Site header with logo, navigation, and user menu (ROK-271 branding).
 * MoreDrawer state is owned by Layout — this component just
 * fires `onMenuClick` when the hamburger is pressed.
 *
 * On mobile, hides on scroll-down and reappears on scroll-up
 * (same pattern as the bottom tab bar).
 */
const NAV_LINKS = [
    { to: '/calendar', label: 'Calendar' },
    { to: '/games', label: 'Games' },
    { to: '/events', label: 'Events' },
    { to: '/players', label: 'Players' },
];

function navClass(current: string, target: string) {
    return `font-medium transition-colors ${current === target ? 'text-emerald-400' : 'text-secondary hover:text-foreground'}`;
}

function DesktopNav({ pathname, user }: { pathname: string; user: User | null }) {
    return (
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map(({ to, label }) => <Link key={to} to={to} className={navClass(pathname, to)}>{label}</Link>)}
            {user && (
                <>
                    <span className="w-px h-5 bg-edge" aria-hidden="true" />
                    <Link to="/insights" className={navClass(pathname, '/insights')}>Insights</Link>
                </>
            )}
        </nav>
    );
}

function DesktopActions({ user }: { user: User | null }) {
    return (
        <div className="hidden md:flex items-center gap-4">
            <ThemeToggle />
            {user ? (<><NotificationBell /><UserMenu /></>) : (
                <Link to="/login" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-foreground font-semibold rounded-lg transition-colors text-sm">Login</Link>
            )}
        </div>
    );
}

function CommunityLogo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
    return (
        <Link to="/" className="flex items-center gap-2 text-xl font-bold text-foreground hover:text-emerald-400 transition-colors">
            {logoUrl ? <img src={logoUrl} alt={name} className="w-8 h-8 rounded-lg object-contain" /> : <span className="text-2xl">&#x2694;&#xFE0F;</span>}
            {name}
        </Link>
    );
}

export function Header({ onMenuClick }: HeaderProps) {
    const location = useLocation();
    const { user } = useAuth();
    const { data: systemStatus } = useSystemStatus();
    const isHidden = useScrollDirection() === 'down';
    const communityName = systemStatus?.communityName || 'Raid Ledger';
    const communityLogoUrl = systemStatus?.communityLogoUrl ? `${API_BASE_URL}${systemStatus.communityLogoUrl}` : null;

    return (
        <>
            <a href="#main-content" className="skip-link">Skip to main content</a>
            <header className={`sticky top-0 bg-backdrop/95 backdrop-blur-sm border-b border-edge-subtle will-change-transform md:will-change-auto md:translate-y-0 ${isHidden ? '-translate-y-full' : 'translate-y-0'}`}
                style={{ zIndex: Z_INDEX.HEADER, transition: 'transform 300ms ease-in-out' }}>
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <CommunityLogo logoUrl={communityLogoUrl} name={communityName} />
                    <DesktopNav pathname={location.pathname} user={user} />
                    <div className="flex items-center gap-4">
                        <DesktopActions user={user} />
                        {user && <div className="md:hidden"><NotificationBell /></div>}
                        <button onClick={onMenuClick} className="md:hidden p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel" aria-label="Open menu">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                        </button>
                    </div>
                </div>
            </header>
        </>
    );
}
