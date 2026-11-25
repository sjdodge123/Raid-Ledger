/**
 * ROK-2370: state machine for the Discord-app sign-in code.
 *
 * idle → starting → waiting → approved | expired | error. Polls only while
 * the page is visible, polls at once when it becomes visible again (the member
 * is back from Discord), and resumes a code saved in sessionStorage on mount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    clearPendingSigninCode,
    pollSigninCode,
    readPendingSigninCode,
    savePendingSigninCode,
    startSigninCode,
    type PendingSigninCode,
} from '../../lib/signin-code';

export type SigninCodeState =
    | { phase: 'idle' }
    | { phase: 'starting' }
    | { phase: 'waiting'; pending: PendingSigninCode; resumed: boolean }
    | { phase: 'approved' }
    | { phase: 'expired' }
    | { phase: 'error' };

type Finish = (next: SigninCodeState) => void;

/**
 * Poll one pending code until it is approved or expires. Returns a stop
 * function. An approval is always handed to `onApproved`, even after stop:
 * the server has already consumed it and set the refresh cookie.
 */
export function runSigninCodePoll(
    waiting: Extract<SigninCodeState, { phase: 'waiting' }>,
    finish: Finish,
    onApproved: (accessToken: string) => void,
): () => void {
    const { pending } = waiting;
    let stopped = false;
    let inFlight = false;
    let timer: number | undefined;
    const schedule = (): void => { timer = window.setTimeout(() => void tick(), pending.pollIntervalMs); };
    const tick = async (): Promise<void> => {
        window.clearTimeout(timer);
        if (stopped || inFlight) return;
        if (Date.now() >= Date.parse(pending.expiresAt)) return finish({ phase: 'expired' });
        if (document.visibilityState !== 'visible') return;
        inFlight = true;
        const res = await pollSigninCode(pending.deviceSecret);
        inFlight = false;
        if (res.status === 'approved') return approve(res.session.access_token);
        if (stopped) return;
        if (res.status === 'expired') return finish({ phase: 'expired' });
        schedule();
    };
    const approve = (token: string): void => { finish({ phase: 'approved' }); onApproved(token); };
    const onVisibility = (): void => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisibility);
    if (waiting.resumed) void tick(); else schedule();
    return () => {
        stopped = true;
        window.clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}

function initialState(): SigninCodeState {
    const pending = readPendingSigninCode(Date.now());
    return pending ? { phase: 'waiting', pending, resumed: true } : { phase: 'idle' };
}

interface StartGuard { begin: () => number; isCurrent: (id: number) => boolean; invalidate: () => void }

/**
 * A start answered after cancel, unmount or a newer start is stale: its code
 * must never be saved or shown (it would revive an abandoned code or
 * overwrite the newer one). Remount-safe for StrictMode's double effects.
 */
function useStartGuard(): StartGuard {
    const seq = useRef(0);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);
    const [guard] = useState<StartGuard>(() => ({
        begin: () => ++seq.current,
        isCurrent: (id) => alive.current && id === seq.current,
        invalidate: () => { seq.current += 1; },
    }));
    return guard;
}

/** Drive one sign-in code; `onApproved` receives the session's access token. */
export function useSigninCode(onApproved: (accessToken: string) => void): {
    state: SigninCodeState; start: () => Promise<void>; cancel: () => void;
} {
    const [state, setState] = useState<SigninCodeState>(initialState);
    const onApprovedRef = useRef(onApproved);
    useEffect(() => { onApprovedRef.current = onApproved; }, [onApproved]);
    const guard = useStartGuard();

    const start = useCallback(async (): Promise<void> => {
        const id = guard.begin();
        clearPendingSigninCode();
        setState({ phase: 'starting' });
        const pending = await startSigninCode();
        if (!guard.isCurrent(id)) return;
        if (!pending) return setState({ phase: 'error' });
        savePendingSigninCode(pending);
        setState({ phase: 'waiting', pending, resumed: false });
    }, [guard]);

    const cancel = useCallback((): void => {
        guard.invalidate();
        clearPendingSigninCode();
        setState({ phase: 'idle' });
    }, [guard]);

    useEffect(() => {
        if (state.phase !== 'waiting') return undefined;
        const finish: Finish = (next) => { clearPendingSigninCode(); setState(next); };
        return runSigninCodePoll(state, finish, (token) => onApprovedRef.current(token));
    }, [state]);

    return { state, start, cancel };
}
