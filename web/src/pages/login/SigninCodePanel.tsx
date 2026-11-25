/**
 * ROK-2370: the Discord-app sign-in code panel inside "Try another way".
 *
 * Starts a code as soon as it mounts (unless one is being resumed), shows it
 * with Copy code and the `/login code:` instruction, and signs this tab in
 * when the member taps "Yes, sign me in" in Discord.
 */
import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { User } from '../../hooks/use-auth';
import { useCodeSignIn } from './use-code-sign-in';
import { useSigninCode } from './use-signin-code';
import {
    EXPIRED_COPY, SIGNIN_FAILED_COPY, START_FAILED_COPY,
    SigninCodeMessage, SigninCodeSignedIn, SigninCodeWaiting,
} from './signin-code-panel-parts';

export { SIGNED_IN_HOLD_MS } from './use-code-sign-in';

/**
 * The code panel. `onSignedIn` receives the signed-in user once the success
 * line has shown and the session is adopted — the login page records the
 * "last used" marker and routes from there.
 */
export function SigninCodePanel({ onSignedIn }: { onSignedIn: (user: User) => void }): JSX.Element {
    const { signIn, adopt, signOut } = useCodeSignIn(onSignedIn);
    const { state, start, cancel } = useSigninCode(adopt);
    const autoStarted = useRef(false);
    useEffect(() => {
        if (autoStarted.current || state.phase !== 'idle') return;
        autoStarted.current = true;
        void start();
    }, [state.phase, start]);

    if (signIn.phase === 'held') {
        return <SigninCodeSignedIn name={signIn.name} onSignOut={signOut} />;
    }
    if (signIn.phase === 'failed') {
        return <SigninCodeMessage message={SIGNIN_FAILED_COPY} action="Get a new code" onAction={() => { signOut(); void start(); }} alert />;
    }
    switch (state.phase) {
        case 'waiting':
            return <SigninCodeWaiting code={state.pending.code} expiresAt={state.pending.expiresAt} onCancel={cancel} />;
        case 'expired':
            return <SigninCodeMessage message={EXPIRED_COPY} action="Get a new code" onAction={() => void start()} />;
        case 'error':
            return <SigninCodeMessage message={START_FAILED_COPY} action="Try again" onAction={() => void start()} alert />;
        case 'idle':
            return <SigninCodeMessage message={null} action="Get a code" onAction={() => void start()} />;
        case 'approved':
            return <p role="status" className="text-sm text-muted text-center">Signing you in…</p>;
        default:
            return <p role="status" className="text-sm text-muted text-center">Getting a code…</p>;
    }
}
