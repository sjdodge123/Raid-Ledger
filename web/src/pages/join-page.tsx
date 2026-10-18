import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { redeemIntent } from '../lib/api-client';
import { LoadingSpinner } from '../components/ui/loading-spinner';
import { toast } from '../lib/toast';
import { API_BASE_URL } from '../lib/config';
import {
    clearCapturedQueryToken, peekCapturedQueryToken, setCapturedQueryToken,
    type CapturedQueryToken,
} from '../lib/query-token-capture';
import { readQueryToken, stripQueryToken } from '../lib/query-token';

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
 *
 * ROK-1839: the intent token is no longer read from the address bar — it is
 * captured and stripped before Sentry initialises (lib/query-token-capture.ts)
 * and handed over from this tab's capture, which is bound to the eventId and
 * intent it was taken with. `searchParams` is still consulted first so any
 * caller that navigates to /join client-side keeps working, and such a URL is
 * stripped on mount too (the module-load strip cannot run for it).
 */
function redirectToDiscord(intent: string | null, eventId: string | null, token: string | null) {
    sessionStorage.setItem('join_intent', JSON.stringify({ intent, eventId, token }));
    // Handed off to the OAuth hop's own record: the capture has done its job.
    clearCapturedQueryToken();
    window.location.href = `${API_BASE_URL}/auth/discord`;
}

async function redeemAndNavigate(token: string, eventId: string | null, navigate: ReturnType<typeof useNavigate>) {
    try {
        const result = await redeemIntent(token);
        if (result.success) toast.success("You're signed up!", { description: 'Your signup has been confirmed.' });
        else toast.info('Join link expired', { description: 'You can still sign up manually on the event page.' });
    } catch { /* fall through */ } finally {
        // ROK-1839: redeemed, rejected or errored, the token has been spent on
        // this page — it must not survive for a reload to replay.
        clearCapturedQueryToken();
    }
    navigate(`/events/${eventId}`, { replace: true });
}

/**
 * ROK-1839 second line of defence. The module-load strip covers a real page
 * load; a CLIENT-SIDE navigation to `/join?...&token=` (an in-app link, a
 * caller that predates the capture) never re-runs it, and Sentry + Session
 * Replay are recording by then. Capture and strip on mount as well, keeping
 * `window.history.state` so react-router's own entry state survives.
 */
function useAddressBarStrip(intent: string | null, eventId: string | null): void {
    useEffect(() => {
        const token = readQueryToken(window.location);
        if (token === null) return;
        setCapturedQueryToken({ token, eventId, intent });
        window.history.replaceState(window.history.state, '', stripQueryToken(window.location));
    }, [intent, eventId]);
}

/**
 * A capture only serves the page it was taken for. A record from an abandoned
 * link (another event, another intent) sitting in this tab must never be
 * redeemed against the event now on screen.
 */
function capturedMatchesPage(
    captured: CapturedQueryToken | null, intent: string | null, eventId: string | null,
): boolean {
    return captured !== null && captured.eventId === eventId && captured.intent === intent;
}

/**
 * Lead ruling (ROK-1839): an unredeemed token must not survive an abandoned or
 * invalid link. Drop a capture this page will not use — one bound to another
 * page, or any left over once the link has been ruled invalid.
 */
function useUnusableCaptureCleanup(
    captured: CapturedQueryToken | null, matches: boolean, isValid: boolean,
): void {
    useEffect(() => {
        if (captured !== null && (!matches || !isValid)) clearCapturedQueryToken();
    }, [captured, matches, isValid]);
}

function useJoinEffect(authLoading: boolean, isAuthenticated: boolean, isValid: boolean, intent: string | null, eventId: string | null, token: string | null, navigate: ReturnType<typeof useNavigate>) {
    const processedRef = useRef(false);
    useEffect(() => {
        if (authLoading || processedRef.current || !isValid) return;
        processedRef.current = true;
        if (!isAuthenticated) { redirectToDiscord(intent, eventId, token); return; }
        void redeemAndNavigate(token!, eventId, navigate);
    }, [authLoading, isAuthenticated, isValid, intent, eventId, token, navigate]);
}

function JoinInvalidState({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <h1 className="text-xl font-semibold text-foreground">Invalid Link</h1>
            <p className="text-muted">This join link is invalid or has expired.</p>
            <button onClick={() => navigate('/calendar')} className="btn btn-secondary">Go to Calendar</button>
        </div>
    );
}

export function JoinPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { isAuthenticated, isLoading: authLoading } = useAuth();

    const intent = searchParams.get('intent');
    const eventId = searchParams.get('eventId');
    const captured = peekCapturedQueryToken();
    const matches = capturedMatchesPage(captured, intent, eventId);
    const urlToken = searchParams.get('token');
    const token = urlToken ?? (matches && captured ? captured.token : null);
    const isValid = useMemo(() => intent === 'signup' && !!eventId && !!token, [intent, eventId, token]);

    useAddressBarStrip(intent, eventId);
    useUnusableCaptureCleanup(captured, matches, isValid);
    useJoinEffect(authLoading, isAuthenticated, isValid, intent, eventId, token, navigate);

    if (!isValid) return <JoinInvalidState navigate={navigate} />;
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <LoadingSpinner />
            <p className="text-muted">{!isAuthenticated ? 'Redirecting to Discord login...' : 'Processing your signup...'}</p>
        </div>
    );
}
