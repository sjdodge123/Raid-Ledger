import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { redeemIntent } from '../lib/api-client';
import { LoadingSpinner } from '../components/ui/loading-spinner';
import { toast } from '../lib/toast';
import { API_BASE_URL } from '../lib/config';

/**
 * /join route — Deferred signup landing page (ROK-137).
 *
 * Handles the "Join & Sign Up" flow from Discord:
 * 1. Validates intent token from query params
 * 2. If user is authenticated, redeems the token and auto-completes signup
 * 3. If not authenticated, initiates Discord OAuth flow
 * 4. After OAuth, redirects back here to complete signup
 * 5. Redirects to event detail page with confirmation
 *
 * Graceful fallback: if token is invalid/expired, redirect to event page
 * with manual signup prompt.
 */
export function JoinPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const processedRef = useRef(false);

    const intent = searchParams.get('intent');
    const eventId = searchParams.get('eventId');
    const token = searchParams.get('token');

    const isValid = useMemo(
        () => intent === 'signup' && !!eventId && !!token,
        [intent, eventId, token],
    );

    useEffect(() => {
        if (authLoading || processedRef.current) return;
        if (!isValid) return;

        if (!isAuthenticated) {
            processedRef.current = true;
            // Store intent params in sessionStorage for post-auth redirect
            sessionStorage.setItem(
                'join_intent',
                JSON.stringify({ intent, eventId, token }),
            );
            window.location.href = `${API_BASE_URL}/auth/discord`;
            return;
        }

        // User is authenticated — try to redeem the intent token
        processedRef.current = true;
        redeemIntent(token!)
            .then((result) => {
                if (result.success) {
                    toast.success("You're signed up!", {
                        description: 'Your signup has been confirmed.',
                    });
                } else {
                    toast.info('Join link expired', {
                        description: 'You can still sign up manually on the event page.',
                    });
                }
                navigate(`/events/${eventId}`, { replace: true });
            })
            .catch(() => {
                navigate(`/events/${eventId}`, { replace: true });
            });
    }, [authLoading, isAuthenticated, isValid, intent, eventId, token, navigate]);

    if (!isValid) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <h1 className="text-xl font-semibold text-foreground">
                    Invalid Link
                </h1>
                <p className="text-muted">
                    This join link is invalid or has expired.
                </p>
                <button
                    onClick={() => navigate('/calendar')}
                    className="btn btn-secondary"
                >
                    Go to Calendar
                </button>
            </div>
        );
    }

    // When not authenticated, processedRef is set before redirect — show redirect text.
    // When authenticated, show processing text.
    const statusText = !isAuthenticated
        ? 'Redirecting to Discord login...'
        : 'Processing your signup...';

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <LoadingSpinner />
            <p className="text-muted">{statusText}</p>
        </div>
    );
}
