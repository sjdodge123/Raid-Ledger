import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { saveAuthRedirect } from '../../lib/auth-redirect';

/**
 * Global auth guard (ROK-283).
 *
 * Wraps all non-public routes as a layout route. Unauthenticated visitors
 * are redirected to the login page (root "/") and the originally requested
 * URL is preserved for post-login redirect.
 *
 * Public routes (login, OAuth callback) are declared *outside* this guard
 * in the router so they remain accessible without authentication.
 */
export function AuthGuard() {
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();

    // Show a full-page spinner while the auth state is being resolved.
    // This prevents any flash of protected content before redirect.
    if (isLoading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-4 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-muted">Checking authentication...</p>
                </div>
            </div>
        );
    }

    // Redirect unauthenticated users to login, preserving the requested URL
    if (!isAuthenticated) {
        const intended = location.pathname + location.search + location.hash;
        // Only save redirect if the user was trying to reach a real page
        // (not the root which is the login page itself)
        if (intended !== '/') {
            saveAuthRedirect(intended);
        }
        return <Navigate to="/" replace />;
    }

    // Authenticated -- render the child route
    return <Outlet />;
}
