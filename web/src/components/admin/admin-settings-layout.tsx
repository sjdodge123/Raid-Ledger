import { useState, useEffect, useCallback } from 'react';
import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin as isAdminCheck } from '../../hooks/use-auth';
import { AdminSidebar } from './admin-sidebar';

/**
 * Admin Settings layout — sidebar + content area with nested <Outlet />.
 * Desktop: fixed sidebar on the left, content scrolls independently.
 * Mobile: hamburger button opens a slide-over drawer.
 * ROK-281: Always-expanded sidebar navigation with dynamic plugin integrations.
 */
export function AdminSettingsLayout() {
    const { user, isLoading } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [mobileOpen, setMobileOpen] = useState(false);

    const closeMobile = useCallback(() => setMobileOpen(false), []);

    // Close mobile drawer on Escape
    useEffect(() => {
        if (!mobileOpen) return;
        function handleEscape(e: KeyboardEvent) {
            if (e.key === 'Escape') setMobileOpen(false);
        }
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [mobileOpen]);

    // Redirect bare /admin/settings to /admin/settings/general
    if (location.pathname === '/admin/settings') {
        return <Navigate to="/admin/settings/general" replace />;
    }

    if (isLoading) {
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

    if (!isAdminCheck(user)) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-8">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
                    <h2 className="text-xl font-semibold text-red-400">Access Denied</h2>
                    <p className="text-muted mt-2">
                        You must be an administrator to access this page.
                    </p>
                    <button
                        onClick={() => navigate('/')}
                        className="mt-4 px-4 py-2 bg-overlay hover:bg-faint rounded-lg text-foreground transition-colors"
                    >
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-4 py-6">
            {/* Header row with mobile hamburger */}
            <div className="flex items-center gap-3 mb-6">
                <button
                    type="button"
                    className="lg:hidden p-2 -ml-2 rounded-lg text-muted hover:text-foreground hover:bg-overlay/30 transition-colors"
                    onClick={() => setMobileOpen(true)}
                    aria-label="Open settings menu"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Admin Settings</h1>
                    <p className="text-sm text-muted mt-0.5">Manage your community configuration</p>
                </div>
            </div>

            <div className="flex gap-6">
                {/* Desktop sidebar */}
                <aside className="hidden lg:block w-56 flex-shrink-0">
                    <div className="sticky top-24">
                        <AdminSidebar />
                    </div>
                </aside>

                {/* Content area */}
                <main className="flex-1 min-w-0">
                    <Outlet />
                </main>
            </div>

            {/* Mobile drawer overlay */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={closeMobile}
                    />
                    {/* Drawer */}
                    <div className="absolute inset-y-0 left-0 w-72 bg-surface border-r border-edge shadow-2xl">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
                            <span className="font-semibold text-foreground text-sm">Settings</span>
                            <button
                                type="button"
                                onClick={closeMobile}
                                className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-overlay/30 transition-colors"
                                aria-label="Close settings menu"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <AdminSidebar onNavigate={closeMobile} />
                    </div>
                </div>
            )}
        </div>
    );
}
