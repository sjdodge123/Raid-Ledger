/**
 * ROK-2370: adopt the session an approved sign-in code collected.
 *
 * The "Signed in as … · Not you? Sign out" hold runs BEFORE the session is
 * published to the app. On `/`, `login()` puts the user in React Query and
 * `RootRedirect` swaps the login page out at once — so a hold after it never
 * shows, and the last-used marker and post-login route never run. The name
 * comes from a read of `/auth/me` that adopts nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, type User } from '../../hooks/use-auth';
import { clearSilentGuard, setAuthMethod } from '../../lib/api/silent-reauth';
import { fetchSigninCodeAccountName } from '../../lib/signin-code';

/** How long "Signed in as …" (with "Not you? Sign out") shows before the session is adopted. */
export const SIGNED_IN_HOLD_MS = 1500;

export type CodeSignIn = { phase: 'none' } | { phase: 'pending' } | { phase: 'failed' } | { phase: 'held'; name: string };

/** Publish the session (`login`), then hand the user over — even after unmount. */
function useCompleteSignIn(onSignedIn: (user: User) => void, onFailed: () => void): (token: string) => void {
    const { login } = useAuth();
    const latest = useRef({ login, onSignedIn, onFailed });
    useEffect(() => { latest.current = { login, onSignedIn, onFailed }; }, [login, onSignedIn, onFailed]);
    return useCallback((token: string): void => {
        // 'magic', never 'discord': a 'discord' marker arms the silent OAuth bounce.
        setAuthMethod('magic');
        clearSilentGuard();
        void latest.current.login(token).then((user) => {
            if (user) latest.current.onSignedIn(user); else latest.current.onFailed();
        });
    }, []);
}

/** The held token: released (adopted) when the hold timer fires or the panel unmounts. */
function useHeldToken(complete: (token: string) => void, signIn: CodeSignIn): {
    heldRef: { current: string | null }; aliveRef: { current: boolean };
} {
    const heldRef = useRef<string | null>(null);
    const aliveRef = useRef(true);
    const release = useCallback((): void => {
        const token = heldRef.current;
        heldRef.current = null;
        if (token) complete(token);
    }, [complete]);
    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; release(); };
    }, [release]);
    useEffect(() => {
        if (signIn.phase !== 'held') return undefined;
        const id = window.setTimeout(release, SIGNED_IN_HOLD_MS);
        return () => window.clearTimeout(id);
    }, [signIn, release]);
    return { heldRef, aliveRef };
}

/** Hold the collected token until the hold ends or the panel unmounts; "Not you?" drops it. */
export function useCodeSignIn(onSignedIn: (user: User) => void): {
    signIn: CodeSignIn; adopt: (token: string) => void; signOut: () => void;
} {
    const { logout } = useAuth();
    const [signIn, setSignIn] = useState<CodeSignIn>({ phase: 'none' });
    const onFailed = useCallback((): void => setSignIn({ phase: 'failed' }), []);
    const complete = useCompleteSignIn(onSignedIn, onFailed);
    const { heldRef, aliveRef } = useHeldToken(complete, signIn);
    const adopt = (token: string): void => {
        setSignIn({ phase: 'pending' });
        void fetchSigninCodeAccountName(token).then((name) => {
            if (!name || !aliveRef.current) return complete(token);
            heldRef.current = token;
            setSignIn({ phase: 'held', name });
        });
    };
    const signOut = (): void => { heldRef.current = null; setSignIn({ phase: 'none' }); logout(); };
    return { signIn, adopt, signOut };
}
