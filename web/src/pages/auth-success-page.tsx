import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../hooks/use-auth';
import { consumeAuthRedirect } from '../components/auth';

/**
 * Handles OAuth callback - extracts token from URL and logs user in.
 * This page is redirected to by the API after successful Discord OAuth.
 * 
 * Supports:
 * - ?token=xyz → successful login
 * - ?error=xyz → OAuth error (denied, expired, etc.)
 */
export function AuthSuccessPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { login } = useAuth();

    useEffect(() => {
        const token = searchParams.get('token');
        const error = searchParams.get('error');

        if (error) {
            // OAuth failed - show error and redirect home
            const errorMessages: Record<string, string> = {
                'access_denied': 'Discord login was cancelled.',
                'expired': 'Login session expired. Please try again.',
                'invalid_state': 'Invalid login session. Please try again.',
            };
            const message = errorMessages[error] || 'Login failed. Please try again.';
            toast.error(message);
            navigate('/', { replace: true });
            return;
        }

        if (token) {
            // Store the token and update auth state
            login(token);

            // Check for saved redirect destination
            const redirectTo = consumeAuthRedirect() || '/events';
            toast.success('Logged in successfully!');
            navigate(redirectTo, { replace: true });
        } else {
            // No token and no error - unexpected, redirect home
            toast.error('Something went wrong. Please try again.');
            navigate('/', { replace: true });
        }
    }, [searchParams, login, navigate]);

    return (
        <div className="min-h-[60vh] flex items-center justify-center">
            <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-400 text-lg">Logging you in...</p>
            </div>
        </div>
    );
}

