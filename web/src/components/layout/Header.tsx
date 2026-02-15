import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserMenu } from './UserMenu';
import { MobileNav } from './MobileNav';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from '../notifications';
import { useAuth } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { API_BASE_URL } from '../../lib/config';
import { Z_INDEX } from '../../lib/z-index';

/**
 * Site header with logo, navigation, and user menu (ROK-271 branding).
 */
export function Header() {
    const location = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
    const { user } = useAuth();
    const { data: systemStatus } = useSystemStatus();

    const communityName = systemStatus?.communityName || 'Raid Ledger';
    const communityLogoUrl = systemStatus?.communityLogoUrl
        ? `${API_BASE_URL}${systemStatus.communityLogoUrl}`
        : null;

    const navLinks = [
        { to: '/calendar', label: 'Calendar' },
        { to: '/games', label: 'Games' },
        { to: '/events', label: 'Events' },
        { to: '/players', label: 'Players' },
    ];

    return (
        <>
            <header className="sticky top-0 bg-backdrop/95 backdrop-blur-sm border-b border-edge-subtle" style={{ zIndex: Z_INDEX.HEADER }}>
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    {/* Logo (ROK-271: custom branding) */}
                    <Link
                        to="/"
                        className="flex items-center gap-2 text-xl font-bold text-foreground hover:text-emerald-400 transition-colors"
                    >
                        {communityLogoUrl ? (
                            <img
                                src={communityLogoUrl}
                                alt={communityName}
                                className="w-8 h-8 rounded-lg object-contain"
                            />
                        ) : (
                            <span className="text-2xl">&#x2694;&#xFE0F;</span>
                        )}
                        {communityName}
                    </Link>

                    {/* Desktop Navigation */}
                    <nav className="hidden md:flex items-center gap-6">
                        {navLinks.map(({ to, label }) => (
                            <Link
                                key={to}
                                to={to}
                                className={`font-medium transition-colors ${location.pathname === to
                                    ? 'text-emerald-400'
                                    : 'text-secondary hover:text-foreground'
                                    }`}
                            >
                                {label}
                            </Link>
                        ))}
                        {user && (
                            <>
                                <span className="w-px h-5 bg-edge" aria-hidden="true" />
                                <Link
                                    to="/event-metrics"
                                    className={`font-medium transition-colors ${location.pathname === '/event-metrics'
                                        ? 'text-emerald-400'
                                        : 'text-secondary hover:text-foreground'
                                        }`}
                                >
                                    Event Metrics
                                </Link>
                            </>
                        )}
                    </nav>

                    {/* Right side: Notification Bell + User menu (desktop) + Hamburger (mobile) */}
                    <div className="flex items-center gap-4">
                        <div className="hidden md:flex items-center gap-4">
                            <ThemeToggle />
                            {user ? (
                                <>
                                    <NotificationBell />
                                    <UserMenu />
                                </>
                            ) : (
                                <Link
                                    to="/login"
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-foreground font-semibold rounded-lg transition-colors text-sm"
                                >
                                    Login
                                </Link>
                            )}
                        </div>

                        {/* Mobile hamburger button */}
                        <button
                            onClick={() => setMobileNavOpen(true)}
                            className="md:hidden p-2 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-panel"
                            aria-label="Open menu"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                    </div>
                </div>
            </header>

            {/* Mobile Navigation Drawer */}
            <MobileNav isOpen={mobileNavOpen} onClose={closeMobileNav} />
        </>
    );
}
