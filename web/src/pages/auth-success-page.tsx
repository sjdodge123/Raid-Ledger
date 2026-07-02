import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from '../lib/toast';
import { useAuth } from '../hooks/use-auth';
import { consumeAuthRedirect } from '../components/auth';
import { API_BASE_URL } from '../lib/config';
import { setAuthMethod, clearSilentGuard, armSilentGuard } from '../lib/api/silent-reauth';
import { ACCESS_TOKEN_KEY } from '../lib/api/auth-storage-keys';
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
        hasProcessedRef.current = true;
        dispatchAuthCallback(searchParams, login, navigate);
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

/**
 * Route the OAuth callback by query params: silent fall-through, error,
 * already-consumed code, fresh code, or the missing-code fallback. Extracted
 * from the effect to keep AuthSuccessPage under the 30-line cap (ROK-1353).
 */
function dispatchAuthCallback(
    searchParams: URLSearchParams,
    login: ReturnType<typeof useAuth>['login'],
    navigate: ReturnType<typeof useNavigate>,
) {
    if (searchParams.get('silent_failed')) { handleSilentFailed(navigate); return; }
    const error = searchParams.get('error');
    if (error) { handleOAuthError(error, navigate); return; }
    const code = searchParams.get('code');
    if (code && sessionStorage.getItem(`oauth_processed_${code}`)) return;
    if (code) {
        sessionStorage.setItem(`oauth_processed_${code}`, '1');
        processAuthCode(code, searchParams, login, navigate);
        return;
    }
    toast.error('Something went wrong. Please try again.');
    navigate('/', { replace: true });
}

/**
 * ROK-1353: handle `?silent_failed=1`. Clear any stale access token, arm the
 * one-shot silent guard so a dead cookie can't trigger another silent
 * redirect, and route to the login screen.
 */
function handleSilentFailed(navigate: ReturnType<typeof useNavigate>) {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    armSilentGuard();
    navigate('/', { replace: true });
}

function handleOAuthError(error: string, navigate: ReturnType<typeof useNavigate>) {
    // ROK-1367: MUST NOT clear the silent-reauth guard here. A silent
    // (prompt=none) attempt that fails at Discord bounces back as `?error=...`;
    // clearing would let the next mount fire another silent attempt → an
    // infinite `/` ↔ Discord loop. The timestamped guard's cooldown re-enables
    // a genuine retry instead (see silent-reauth.ts).
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
            // ROK-1353: this is a Discord login — record the method (drives
            // the silent re-auth fallback) and reset the one-shot guard.
            setAuthMethod('discord');
            clearSilentGuard();
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

