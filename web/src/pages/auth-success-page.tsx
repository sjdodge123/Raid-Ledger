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
        if (hasProcessedRef.current) return;
        const code = searchParams.get('code');
        const error = searchParams.get('error');

        if (code && sessionStorage.getItem(`oauth_processed_${code}`)) { hasProcessedRef.current = true; return; }
        if (error) { hasProcessedRef.current = true; handleOAuthError(error, navigate); return; }

        if (code) {
            hasProcessedRef.current = true;
            sessionStorage.setItem(`oauth_processed_${code}`, '1');
            processAuthCode(code, searchParams, login, navigate);
        } else {
            hasProcessedRef.current = true;
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

function handleOAuthError(error: string, navigate: ReturnType<typeof useNavigate>) {
    const errorMessages: Record<string, string> = {
        'access_denied': 'Discord login was cancelled.',
        'expired': 'Login session expired. Please try again.',
        'invalid_state': 'Invalid login session. Please try again.',
    };
    toast.error(errorMessages[error] || 'Login failed. Please try again.');
    navigate('/', { replace: true });
}

async function exchangeAuthCode(code: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(`${API_BASE_URL}/auth/exchange-code`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }), signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error('Failed to exchange auth code');
    return TokenResponseSchema.parse(await response.json());
}

function resolveNewUserRedirect(searchParams: URLSearchParams, navigate: ReturnType<typeof useNavigate>) {
    const pendingInvite = searchParams.get('invite') || sessionStorage.getItem('invite_code');
    if (pendingInvite) {
        sessionStorage.removeItem('invite_code');
        navigate(`/i/${pendingInvite}?claim=1`, { replace: true });
        return true;
    }
    toast.success('Welcome! Let\'s get you set up.');
    navigate('/onboarding', { replace: true });
    return true;
}

function resolveExistingUserRedirect(searchParams: URLSearchParams, navigate: ReturnType<typeof useNavigate>) {
    const storedIntent = sessionStorage.getItem('join_intent');
    if (storedIntent) {
        sessionStorage.removeItem('join_intent');
        try {
            const d = JSON.parse(storedIntent) as { intent: string; eventId: string; token: string };
            navigate(`/join?intent=${d.intent}&eventId=${d.eventId}&token=${encodeURIComponent(d.token)}`, { replace: true });
            return true;
        } catch { /* fall through */ }
    }
    const inviteCode = searchParams.get('invite') || sessionStorage.getItem('invite_code');
    if (inviteCode) {
        sessionStorage.removeItem('invite_code');
        navigate(`/i/${inviteCode}?claim=1`, { replace: true });
        return true;
    }
    return false;
}

function processAuthCode(
    code: string, searchParams: URLSearchParams,
    login: ReturnType<typeof useAuth>['login'], navigate: ReturnType<typeof useNavigate>,
) {
    void (async () => {
        try {
            const { access_token: token } = await exchangeAuthCode(code);
            const user = await login(token);
            if (!user) throw new Error('Failed to authenticate');

            if (user.role !== 'admin' && !user.onboardingCompletedAt) { resolveNewUserRedirect(searchParams, navigate); return; }
            if (resolveExistingUserRedirect(searchParams, navigate)) return;

            sessionStorage.removeItem(`oauth_processed_${code}`);
            toast.success('Logged in successfully!');
            navigate(consumeAuthRedirect() || '/calendar', { replace: true });
        } catch (err) {
            sessionStorage.removeItem(`oauth_processed_${code}`);
            console.error('Login failed:', err);
            toast.error('Login failed. Please try again.');
            navigate('/', { replace: true });
        }
    })();
}

