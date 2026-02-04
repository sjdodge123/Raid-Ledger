import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';

/**
 * Handles OAuth callback - extracts token from URL and logs user in.
 * This page is redirected to by the API after successful Discord OAuth.
 */
export function AuthSuccessPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { login } = useAuth();

    useEffect(() => {
        const token = searchParams.get('token');

        if (token) {
            // Store the token and update auth state
            login(token);
            // Redirect to events page
            navigate('/events', { replace: true });
        } else {
            // No token - redirect to home with error
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
