import { Navigate } from 'react-router-dom';
import { useAuth, isAdmin } from '../hooks/use-auth';
import { useSystemStatus } from '../hooks/use-system-status';
import { LoginPage } from '../pages/login-page';

/**
 * RootRedirect component (ROK-175 AC-1, AC-2).
 *
 * Handles the root URL behavior:
 * - Authenticated admin with incomplete onboarding → redirect to /admin/setup (ROK-204)
 * - Authenticated users → redirect to /calendar (or /events until calendar is built)
 * - Unauthenticated users → render LoginPage inline (no redirect)
 */
export function RootRedirect() {
    const { user, isAuthenticated, isLoading } = useAuth();
    const { data: systemStatus } = useSystemStatus();

    // Show loading state while checking auth
    if (isLoading) {
        return (
            <div className="min-h-[70vh] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
            </div>
        );
    }

    // Authenticated users
    if (isAuthenticated) {
        // ROK-204 AC-1: Redirect admin to onboarding wizard if not completed
        if (isAdmin(user) && systemStatus?.onboardingCompleted === false) {
            return <Navigate to="/admin/setup" replace />;
        }
        // ROK-175 AC-1: Regular users go to calendar
        return <Navigate to="/calendar" replace />;
    }

    // Unauthenticated users see login page inline (no URL redirect)
    return <LoginPage />;
}
