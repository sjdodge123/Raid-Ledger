import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { saveAuthRedirect } from '../../lib/auth-redirect';

/**
 * ROK-1947: the hub request's 401 survived the transparent refresh, so this
 * tab's session is over even though the cached `/auth/me` user still opens the
 * AuthGuard. Signing in again ends the stale session, keeps this page as the
 * post-sign-in destination, and goes to the login screen.
 */
export function useSignInAgain(): () => void {
    const { logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    return () => {
        const here = location.pathname + location.search + location.hash;
        logout();
        saveAuthRedirect(here);
        navigate('/', { replace: true });
    };
}
