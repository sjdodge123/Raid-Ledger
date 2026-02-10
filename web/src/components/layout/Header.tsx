import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserMenu } from './UserMenu';
import { MobileNav } from './MobileNav';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from '../notifications';
import { useAuth } from '../../hooks/use-auth';

/**
 * Site header with logo, navigation, and user menu.
 */
export function Header() {
    const location = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const { user } = useAuth();

    const navLinks = [
        { to: '/calendar', label: 'Calendar' },
        { to: '/games', label: 'Games' },
        { to: '/events', label: 'Events' },
    ];

    return (
        <>
            <header className="sticky top-0 z-40 bg-backdrop/95 backdrop-blur-sm border-b border-edge-subtle">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    {/* Logo */}
                    <Link
                        to="/"
                        className="flex items-center gap-2 text-xl font-bold text-foreground hover:text-emerald-400 transition-colors"
                    >
                        <span className="text-2xl">⚔️</span>
                        Raid Ledger
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
            <MobileNav isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        </>
    );
}
