import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';

const AUTH_REDIRECT_KEY = 'authRedirect';

/**
 * Save the intended destination for post-login redirect.
 */
export function saveAuthRedirect(path: string): void {
    sessionStorage.setItem(AUTH_REDIRECT_KEY, path);
}

/**
 * Get and clear the saved auth redirect.
 */
export function consumeAuthRedirect(): string | null {
    const redirect = sessionStorage.getItem(AUTH_REDIRECT_KEY);
    if (redirect) {
        sessionStorage.removeItem(AUTH_REDIRECT_KEY);
    }
    return redirect;
}

interface ProtectedRouteProps {
    children: React.ReactNode;
}

/**
 * Wrapper component that requires authentication.
 * Redirects to /login and saves the intended destination.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { isAuthenticated, isLoading } = useAuth();
    const location = useLocation();

    // Show loading spinner while checking auth state
    if (isLoading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-4 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-400">Checking authentication...</p>
                </div>
            </div>
        );
    }

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
        // Save current path for post-login redirect (including search and hash)
        saveAuthRedirect(location.pathname + location.search + location.hash);
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}
