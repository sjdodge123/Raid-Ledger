import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { Z_INDEX } from '../../lib/z-index';

import { ProfileSidebar } from './profile-sidebar';
import { toast } from '../../lib/toast';
import './integration-hub.css';

export function ProfileLayout() {
    const { user, isLoading: authLoading, isAuthenticated, refetch } = useAuth();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const [mobileOpen, setMobileOpen] = useState(false);

    const closeMobile = useCallback(() => setMobileOpen(false), []);

    // Handle Discord link callback search params (?linked=success/error)
    const processedRef = useRef(false);
    useEffect(() => {
        if (processedRef.current) return;
        const linked = searchParams.get('linked');
        const message = searchParams.get('message');
        if (linked === 'success') {
            processedRef.current = true;
            toast.success('Discord account linked successfully!');
            setSearchParams({});
            refetch();
        } else if (linked === 'error') {
            processedRef.current = true;
            toast.error(message || 'Failed to link Discord account');
            setSearchParams({});
        }
    }, [searchParams, setSearchParams, refetch]);

    useEffect(() => {
        if (!mobileOpen) return;
        function handleEscape(e: KeyboardEvent) {
            if (e.key === 'Escape') setMobileOpen(false);
        }
        document.addEventListener('keydown', handleEscape);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [mobileOpen]);


    if (location.pathname === '/profile' || location.pathname === '/profile/') {
        return <Navigate to="/profile/identity" replace />;
    }
    if (location.pathname === '/profile/preferences' || location.pathname === '/profile/preferences/') {
        return <Navigate to="/profile/preferences/appearance" replace />;
    }
    if (location.pathname === '/profile/gaming' || location.pathname === '/profile/gaming/') {
        return <Navigate to="/profile/gaming/game-time" replace />;
    }

    if (authLoading) {
        return (
            <div className="max-w-6xl mx-auto px-4 py-8">
                <div className="animate-pulse">
                    <div className="h-8 bg-overlay rounded w-48 mb-4" />
                    <div className="h-4 bg-overlay rounded w-64 mb-8" />
                    <div className="bg-panel/50 rounded-xl h-96" />
                </div>
            </div>
        );
    }

    if (!isAuthenticated || !user) {
        return <Navigate to="/" replace />;
    }

    return (
        <div className="profile-page relative min-h-screen px-4">
            <div className="profile-page__nebula" />
            <div className="profile-page__stars" />

            <div className="relative z-10 max-w-6xl mx-auto pt-6">
                <div className="flex items-center gap-3 mb-6 md:hidden">
                    <button
                        type="button"
                        className="p-2 -ml-2 rounded-lg text-muted hover:text-foreground hover:bg-overlay/30 transition-colors"
                        onClick={() => setMobileOpen(true)}
                        aria-label="Open profile menu"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <h1 className="text-lg font-bold text-foreground">My Profile</h1>
                </div>

                <div className="flex gap-6">
                    <aside className="hidden md:block w-56 flex-shrink-0">
                        <div className="sticky top-8">
                            <ProfileSidebar />
                        </div>
                    </aside>

                    <main className="flex-1 min-w-0">
                        <Outlet />
                    </main>
                </div>

                <div
                    className={`fixed inset-0 md:hidden ${mobileOpen ? 'visible' : 'invisible pointer-events-none'}`}
                    style={{ zIndex: Z_INDEX.MODAL }}
                    aria-hidden={!mobileOpen}
                >
                    <div
                        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
                        onClick={closeMobile}
                        aria-hidden="true"
                    />
                    <div className={`absolute top-0 right-0 w-72 h-full bg-surface border-l border-edge-subtle shadow-2xl transform transition-transform duration-200 ease-out ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-edge-subtle">
                            <span className="font-semibold text-foreground text-sm">Profile</span>
                            <button
                                type="button"
                                onClick={closeMobile}
                                className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-muted hover:text-foreground hover:bg-overlay/30 transition-colors"
                                aria-label="Close profile menu"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <ProfileSidebar onNavigate={closeMobile} />
                    </div>
                </div>
            </div>
        </div>
    );
}
