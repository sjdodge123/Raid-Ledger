import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { redeemIntent } from '../lib/api-client';
import { LoadingSpinner } from '../components/ui/loading-spinner';
import { toast } from '../lib/toast';
import { API_BASE_URL } from '../lib/config';
import {
    clearCapturedQueryToken, peekCapturedQueryToken, setCapturedQueryToken,
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
    const navigate = useNavigate();
    const { state } = useLocation();
    useEffect(() => {
        const token = readQueryToken(window.location);
        if (token === null) return;
        setCapturedQueryToken({ token, eventId, intent });
        // r2 (Opus M1): go through the ROUTER, not a bare
        // `history.replaceState`. The latter never notifies react-router, so
        // its in-memory location — and every `useSearchParams()` reader after
        // us — would keep `?token=` for the life of this history entry even
        // though the address bar is clean. `replace` keeps Back working and
        // `state` carries this entry's own router state across, which is what
        // passing `window.history.state` protected before.
        navigate(stripQueryToken(window.location), { replace: true, state });
    }, [intent, eventId, navigate, state]);
}

/** What this page may spend, and whether a stored capture must be dropped. */
interface ResolvedJoinToken {
    /** The token to redeem — from the address bar, or this tab's capture. */
    token: string | null;
    /** A stored capture this page must not keep: it belongs to another page. */
    unusable: boolean;
}

/**
 * r2 (Codex P2): the capture is read ONCE and both decisions — which token to
 * spend, and whether a stored one has to go — come out of that single read.
 * Reading it again inside the cleanup effect was a race: the mount strip
 * writes a capture between render and effect, so the effect judged the
 * PREVIOUS snapshot and could clear the token this page had just legitimately
 * captured (or keep one it had just ruled unusable).
 *
 * A capture only serves the page it was taken for: a record from an abandoned
 * link (another event, another intent) must never be redeemed against the
 * event now on screen. An expired one never gets this far — `peek` drops it.
 */
function resolveJoinToken(
    urlToken: string | null, intent: string | null, eventId: string | null,
): ResolvedJoinToken {
    if (urlToken !== null) return { token: urlToken, unusable: false };
    const captured = peekCapturedQueryToken();
    if (captured === null) return { token: null, unusable: false };
    const matches = captured.eventId === eventId && captured.intent === intent;
    return matches ? { token: captured.token, unusable: false } : { token: null, unusable: true };
}

/**
 * Lead ruling (ROK-1839): an unredeemed token must not survive an abandoned or
 * invalid link. Drop a capture this page will not use — one bound to another
 * page, or any left over once the link has been ruled invalid. The clear is
 * idempotent, so running it on a page that captured nothing costs nothing.
 */
function useUnusableCaptureCleanup(unusable: boolean, isValid: boolean): void {
    useEffect(() => {
        if (unusable || !isValid) clearCapturedQueryToken();
    }, [unusable, isValid]);
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
    const urlToken = searchParams.get('token');
    const { token, unusable } = useMemo(
        () => resolveJoinToken(urlToken, intent, eventId), [urlToken, intent, eventId],
    );
    const isValid = useMemo(() => intent === 'signup' && !!eventId && !!token, [intent, eventId, token]);

    useAddressBarStrip(intent, eventId);
    useUnusableCaptureCleanup(unusable, isValid);
    useJoinEffect(authLoading, isAuthenticated, isValid, intent, eventId, token, navigate);

    if (!isValid) return <JoinInvalidState navigate={navigate} />;
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <LoadingSpinner />
            <p className="text-muted">{!isAuthenticated ? 'Redirecting to Discord login...' : 'Processing your signup...'}</p>
        </div>
    );
}
