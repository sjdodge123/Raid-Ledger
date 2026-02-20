import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from '../lib/toast';
import { useAuth } from '../hooks/use-auth';
import { consumeAuthRedirect } from '../components/auth';
import { API_BASE_URL } from '../lib/config';

/**
 * Handles OAuth callback - exchanges one-time auth code for JWT token.
 * This page is redirected to by the API after successful Discord OAuth.
 *
 * Supports:
 * - ?code=xyz → exchange for JWT via POST /auth/exchange-code
 * - ?error=xyz → OAuth error (denied, expired, etc.)
 */
export function AuthSuccessPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { login } = useAuth();
    const hasProcessedRef = useRef(false);

    useEffect(() => {
        // Prevent duplicate processing in React Strict Mode.
        // useRef alone doesn't survive Strict Mode's unmount/remount cycle,
        // so we also check sessionStorage keyed on the actual code value.
        if (hasProcessedRef.current) return;

        const code = searchParams.get('code');
        const error = searchParams.get('error');

        if (code && sessionStorage.getItem(`oauth_processed_${code}`)) {
            hasProcessedRef.current = true;
            return;
        }

        if (error) {
            hasProcessedRef.current = true;
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

        if (code) {
            hasProcessedRef.current = true;
            sessionStorage.setItem(`oauth_processed_${code}`, '1');
            (async () => {
                try {
                    // Exchange one-time code for JWT token
                    const exchangeResponse = await fetch(`${API_BASE_URL}/auth/exchange-code`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code }),
                    });

                    if (!exchangeResponse.ok) {
                        throw new Error('Failed to exchange auth code');
                    }

                    const { access_token: token } = await exchangeResponse.json() as { access_token: string };

                    // Store token and wait for auth state to update (refetchQueries awaits)
                    const success = await login(token);

                    // ROK-219: Redirect new non-admin users to onboarding wizard
                    if (success) {
                        // Fetch fresh user data to check onboarding status
                        const authData = await fetch(`${API_BASE_URL}/auth/me`, {
                            headers: { Authorization: `Bearer ${token}` },
                        }).then((r) => r.json()) as { role?: string; onboardingCompletedAt?: string | null };

                        if (authData.role !== 'admin' && !authData.onboardingCompletedAt) {
                            toast.success('Welcome! Let\'s get you set up.');
                            navigate('/onboarding', { replace: true });
                            return;
                        }
                    }

                    // ROK-137: Check for stored join intent from Discord signup flow
                    const storedIntent = sessionStorage.getItem('join_intent');
                    if (storedIntent) {
                        sessionStorage.removeItem('join_intent');
                        try {
                            const intentData = JSON.parse(storedIntent) as {
                                intent: string;
                                eventId: string;
                                token: string;
                            };
                            const joinUrl = `/join?intent=${intentData.intent}&eventId=${intentData.eventId}&token=${encodeURIComponent(intentData.token)}`;
                            navigate(joinUrl, { replace: true });
                            return;
                        } catch {
                            // Invalid stored intent, fall through to normal redirect
                        }
                    }

                    // ROK-263: Check for stored invite code from magic invite link flow
                    const storedInviteCode = sessionStorage.getItem('invite_code');
                    if (storedInviteCode) {
                        navigate(`/i/${storedInviteCode}`, { replace: true });
                        return;
                    }

                    sessionStorage.removeItem(`oauth_processed_${code}`);
                    const redirectTo = consumeAuthRedirect() || '/calendar';
                    toast.success('Logged in successfully!');
                    navigate(redirectTo, { replace: true });
                } catch (err) {
                    sessionStorage.removeItem(`oauth_processed_${code}`);
                    console.error('Login failed:', err);
                    toast.error('Login failed. Please try again.');
                    navigate('/', { replace: true });
                }
            })();
        } else {
            hasProcessedRef.current = true;
            // No code and no error - unexpected, redirect home
            toast.error('Something went wrong. Please try again.');
            navigate('/', { replace: true });
        }
    }, [searchParams, login, navigate]);

    return (
        <div className="min-h-[60vh] flex items-center justify-center">
            <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-muted text-lg">Logging you in...</p>
            </div>
        </div>
    );
}

