import { useCallback, useEffect, useRef, useState } from 'react';
import { LinkStartError, startAccountLink, type LinkProvider } from '../lib/api/link-start-api';
import { toast } from '../lib/toast';

const PROVIDER_LABEL: Record<LinkProvider, string> = { discord: 'Discord', steam: 'Steam' };

function failureMessage(provider: LinkProvider, err: unknown): string {
    const label = PROVIDER_LABEL[provider];
    if (err instanceof LinkStartError && err.status === 401) return `Please log in again to link ${label}`;
    return `Could not start ${label} linking. Please try again.`;
}

/** Re-enable the trigger when the browser restores this page from the back/forward cache. */
function useResetOnPageRestore(reset: () => void) {
    useEffect(() => {
        const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) reset(); };
        window.addEventListener('pageshow', onPageShow);
        return () => window.removeEventListener('pageshow', onPageShow);
    }, [reset]);
}

/**
 * ROK-1630: POST /auth/{provider}/link/start, then navigate to the single-use
 * `?nonce=` hop. `isPending` stays true from the call until the page unloads
 * (or the start fails), so callers disable the trigger; a second call while
 * one is pending is a no-op. A failure shows a toast and does not navigate.
 */
export function useLinkStart(provider: LinkProvider) {
    const inFlight = useRef(false);
    const [isPending, setIsPending] = useState(false);
    const reset = useCallback(() => { inFlight.current = false; setIsPending(false); }, []);
    useResetOnPageRestore(reset);

    const start = useCallback(async (returnTo?: string) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setIsPending(true);
        try {
            window.location.href = await startAccountLink(provider, returnTo);
        } catch (err) {
            reset();
            toast.error(failureMessage(provider, err));
        }
    }, [provider, reset]);

    return { start, isPending };
}
