import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin as isAdminCheck } from '../../hooks/use-auth';
import { AdminSidebar } from './admin-sidebar';

/**
 * Admin Settings layout — sidebar + content area with nested <Outlet />.
 * Desktop: fixed sidebar on the left, content scrolls independently.
 * Mobile: navigation is handled by the MoreDrawer accordion (ROK-354).
 * ROK-281: Always-expanded sidebar navigation with dynamic plugin integrations.
 */
export function AdminSettingsLayout() {
    const { user, isLoading } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

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
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-foreground">Admin Settings</h1>
                <p className="text-sm text-muted mt-0.5">Manage your community configuration</p>
            </div>

            <div className="flex gap-6">
                {/* Desktop sidebar */}
                <aside className="hidden md:block w-56 flex-shrink-0">
                    <div className="sticky top-24">
                        <AdminSidebar />
                    </div>
                </aside>

                {/* Content area */}
                <main className="flex-1 min-w-0">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
