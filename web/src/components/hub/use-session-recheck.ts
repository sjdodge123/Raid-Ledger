import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshWithOutcome } from '../../lib/api/refresh-client';
import { getAuthMethod } from '../../lib/api/silent-reauth';

/** What the hub's 401 screen shows while/after it re-checks the session. */
export type SessionCheck = 'checking' | 'rejected' | 'indeterminate';

/** No session marker → nothing to refresh or revoke: the session is over. */
async function checkSession(): Promise<'ok' | SessionCheck> {
    if (!getAuthMethod()) return 'rejected';
    return (await refreshWithOutcome()).kind;
}

/**
 * ROK-1947: a hub request's 401 does not prove the session is over — a phone
 * waking up may have hit a 503/429/network blip on the transparent refresh.
 * Re-check through the shared single-flight refresh: `ok` → `onRecovered`
 * (refetch the hub); `rejected` → the sign-in prompt; `indeterminate` → a
 * "couldn't reach the server" state whose `retry` runs the check again. If the
 * refetch after an `ok` still 401s, the session is treated as rejected.
 */
export function useSessionRecheck(onRecovered: () => unknown): { state: SessionCheck; retry: () => void } {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<SessionCheck>('checking');
    const recoveredRef = useRef(onRecovered);
    useEffect(() => {
        recoveredRef.current = onRecovered;
    });
    useEffect(() => {
        let live = true;
        void (async () => {
            const outcome = await checkSession();
            if (outcome === 'ok') await Promise.resolve(recoveredRef.current());
            // Still mounted after a recovered refetch = the hub still answers 401.
            if (live) setState(outcome === 'ok' ? 'rejected' : outcome);
        })();
        return () => {
            live = false;
        };
    }, [attempt]);
    const retry = useCallback(() => {
        setState('checking');
        setAttempt((n) => n + 1);
    }, []);
    return { state, retry };
}
