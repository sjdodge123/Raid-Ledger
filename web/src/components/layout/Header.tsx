import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserMenu } from './UserMenu';
import { MobileNav } from './MobileNav';

/**
 * Site header with logo, navigation, and user menu.
 */
export function Header() {
    const location = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    const navLinks = [
        { to: '/events', label: 'Events' },
    ];

    return (
        <>
            <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    {/* Logo */}
                    <Link
                        to="/"
                        className="flex items-center gap-2 text-xl font-bold text-white hover:text-emerald-400 transition-colors"
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
                                    : 'text-slate-300 hover:text-white'
                                    }`}
                            >
                                {label}
                            </Link>
                        ))}
                    </nav>

                    {/* Right side: User menu (desktop) + Hamburger (mobile) */}
                    <div className="flex items-center gap-4">
                        <div className="hidden md:block">
                            <UserMenu />
                        </div>

                        {/* Mobile hamburger button */}
                        <button
                            onClick={() => setMobileNavOpen(true)}
                            className="md:hidden p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
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
