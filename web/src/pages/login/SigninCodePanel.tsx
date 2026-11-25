/**
 * ROK-2370: the Discord-app sign-in code panel inside "Try another way".
 *
 * Starts a code as soon as it mounts (unless one is being resumed), shows it
 * with Copy code and the `/login code:` instruction, and signs this tab in
 * when the member taps "Yes, sign me in" in Discord.
 */
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useAuth, type User } from '../../hooks/use-auth';
import { clearSilentGuard, setAuthMethod } from '../../lib/api/silent-reauth';
import { useSigninCode } from './use-signin-code';
import {
    EXPIRED_COPY, SIGNIN_FAILED_COPY, START_FAILED_COPY,
    SigninCodeMessage, SigninCodeSignedIn, SigninCodeWaiting,
} from './signin-code-panel-parts';

/** How long the "Signed in as …" line shows before `onSignedIn` routes away. */
export const SIGNED_IN_HOLD_MS = 1500;

type SignIn = { phase: 'none' } | { phase: 'pending' } | { phase: 'failed' } | { phase: 'done'; user: User };

/** Adopt the approved session the way `/signin-link` does, then hold briefly and hand over. */
function useCodeSignIn(onSignedIn: (user: User) => void): {
    signIn: SignIn; adopt: (token: string) => void; signOut: () => void;
} {
    const { login, logout } = useAuth();
    const [signIn, setSignIn] = useState<SignIn>({ phase: 'none' });
    const adopt = (token: string): void => {
        setSignIn({ phase: 'pending' });
        // 'magic', never 'discord': a 'discord' marker arms the silent OAuth bounce.
        setAuthMethod('magic');
        clearSilentGuard();
        void login(token).then((user) => setSignIn(user ? { phase: 'done', user } : { phase: 'failed' }));
    };
    useEffect(() => {
        if (signIn.phase !== 'done') return undefined;
        const id = window.setTimeout(() => onSignedIn(signIn.user), SIGNED_IN_HOLD_MS);
        return () => window.clearTimeout(id);
    }, [signIn, onSignedIn]);
    const signOut = (): void => { setSignIn({ phase: 'none' }); logout(); };
    return { signIn, adopt, signOut };
}

/**
 * The code panel. `onSignedIn` receives the signed-in user once the success
 * line has shown — the login page routes from there (and L3b records the
 * "last used" marker there).
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

    if (signIn.phase === 'done') {
        return <SigninCodeSignedIn name={signIn.user.displayName ?? signIn.user.username} onSignOut={signOut} />;
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
