import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from '../lib/toast';
import { useAuth } from '../hooks/use-auth';
import { consumeAuthRedirect } from '../components/auth';
import { API_BASE_URL } from '../lib/config';
import { TokenResponseSchema } from '@raid-ledger/contract';

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
                    // Exchange one-time code for JWT token (15s timeout for mobile resilience)
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 15_000);
                    const exchangeResponse = await fetch(`${API_BASE_URL}/auth/exchange-code`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code }),
                        signal: controller.signal,
                    });
                    clearTimeout(timeout);

                    if (!exchangeResponse.ok) {
                        throw new Error('Failed to exchange auth code');
                    }

                    const { access_token: token } = TokenResponseSchema.parse(await exchangeResponse.json());

                    // Store token and fetch user data in one step
                    const user = await login(token);

                    if (!user) {
                        throw new Error('Failed to authenticate');
                    }

                    // ROK-219: Redirect new non-admin users to onboarding wizard
                    // ROK-394: Preserve invite code so claim happens after onboarding
                    // ROK-407: PUG invite users bypass FTE — go straight to claim
                    if (user.role !== 'admin' && !user.onboardingCompletedAt) {
                        const pendingInvite = searchParams.get('invite') || sessionStorage.getItem('invite_code');
                        if (pendingInvite) {
                            // PUG invite flow — bypass FTE, go straight to claim
                            sessionStorage.removeItem('invite_code');
                            navigate(`/i/${pendingInvite}?claim=1`, { replace: true });
                            return;
                        }
                        // Normal signup — go through FTE
                        toast.success('Welcome! Let\'s get you set up.');
                        navigate('/onboarding', { replace: true });
                        return;
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

                    // ROK-394: Check for invite code from state param (preferred) or sessionStorage (fallback)
                    const inviteCodeFromParam = searchParams.get('invite');
                    const storedInviteCode = sessionStorage.getItem('invite_code');
                    const inviteCode = inviteCodeFromParam || storedInviteCode;
                    if (inviteCode) {
                        sessionStorage.removeItem('invite_code');
                        // Redirect to invite page with ?claim=1 to trigger auto-claim
                        navigate(`/i/${inviteCode}?claim=1`, { replace: true });
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

