import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshWithOutcome } from '../../lib/api/refresh-client';
import { getAuthMethod } from '../../lib/api/silent-reauth';
import { httpStatusOf } from '../../lib/api/api-error';

/** What the hub's 401 screen shows while/after it re-checks the session. */
export type SessionCheck = 'checking' | 'rejected' | 'indeterminate';

/** No session marker → nothing to refresh or revoke: the session is over. */
async function checkSession(): Promise<'ok' | SessionCheck> {
    if (!getAuthMethod()) return 'rejected';
    return (await refreshWithOutcome()).kind;
}

/** The parts of the hub refetch's result the re-check reads. */
export type RecoveryResult = { status: 'pending' | 'error' | 'success'; error: unknown };

/**
 * A refetch after an `ok` re-check: null = it landed (keep 'checking' until
 * unmount). Only `success` landed — a refetch silently cancelled by a later
 * drop resolves `pending` with no error, which must offer Try again, not spin.
 */
function afterRecovery({ status, error }: RecoveryResult): SessionCheck | null {
    if (status === 'success') return null;
    return httpStatusOf(error) === 401 ? 'rejected' : 'indeterminate';
}

/**
 * ROK-1947: a hub request's 401 does not prove the session is over — a phone
 * waking up may have hit a 503/429/network blip on the transparent refresh.
 * Re-check through the shared single-flight refresh: `ok` → `onRecovered`
 * (refetch the hub); `rejected` → the sign-in prompt; `indeterminate` → a
 * "couldn't reach the server" state whose `retry` runs the check again. The
 * refetch's own result decides what follows an `ok`: still a 401 → rejected;
 * any other error → indeterminate; success → stay 'checking' while the page
 * swaps this screen out (no "session expired" frame on the success path).
 */
export function useSessionRecheck(
    onRecovered: () => Promise<RecoveryResult>,
): { state: SessionCheck; retry: () => void } {
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
            if (live) setState(outcome === 'ok' ? 'rejected' : outcome);
            void afterRecovery;
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
