import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { LoginPage } from '../pages/login-page';

/**
 * RootRedirect component (ROK-175 AC-1, AC-2).
 * 
 * Handles the root URL behavior:
 * - Authenticated users → redirect to /calendar (or /events until calendar is built)
 * - Unauthenticated users → render LoginPage inline (no redirect)
 */
export function RootRedirect() {
    const { isAuthenticated, isLoading } = useAuth();

    // Show loading state while checking auth
    if (isLoading) {
        return (
            <div className="min-h-[70vh] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
            </div>
        );
    }

    // Authenticated users go to calendar (ROK-175 AC-1)
    if (isAuthenticated) {
        return <Navigate to="/calendar" replace />;
    }

    // Unauthenticated users see login page inline (no URL redirect)
    return <LoginPage />;
}
