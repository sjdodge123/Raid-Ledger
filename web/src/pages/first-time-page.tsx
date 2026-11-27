/**
 * ROK-2371 D1(a): `/auth/first-time`, public — a Google (or Discord) sign-in
 * met an identity no account has. The server parked it behind an httpOnly
 * cookie; this page offers "I already have an account — sign in with <other>"
 * (the other provider's sign-in, which links the parked identity) or "Create
 * a new account". The browser's last-used marker naming the other method
 * makes that option the primary button. `?error=` carries the pending-link
 * outcome; `?invite=` is carried to whichever sign-in finishes (auth-success
 * reads `invite_code` from sessionStorage).
 */
import { useEffect, useState, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { safeSessionSetItem } from '../lib/safe-storage';
import {
    createFirstTimeAccount, fetchPendingIdentity, lastUsedNames, pendingLinkUrl, type PendingIdentityResult,
} from './first-time/first-time-api';
import { CREATE_FAILED_COPY, LOAD_FAILED_COPY, firstTimeErrorCopy } from './first-time/first-time-copy';
import { FirstTimeChoiceCard, FirstTimeExpiredCard, FirstTimeLoadingCard } from './first-time/first-time-cards';

/** Same-origin redirects stay in the SPA; anything else is a full navigation. */
function useFollowRedirect(): (redirect: string) => void {
    const navigate = useNavigate();
    return (redirect: string): void => {
        const url = new URL(redirect, window.location.origin);
        if (url.origin === window.location.origin) navigate(`${url.pathname}${url.search}`, { replace: true });
        else window.location.assign(redirect);
    };
}

function usePendingIdentity(): PendingIdentityResult | null {
    const [result, setResult] = useState<PendingIdentityResult | null>(null);
    useEffect(() => {
        let live = true;
        void fetchPendingIdentity().then((r) => { if (live) setResult(r); });
        return () => { live = false; };
    }, []);
    return result;
}

function useCreate(onExpired: () => void): { creating: boolean; failed: string | null; create: () => void } {
    const follow = useFollowRedirect();
    const [creating, setCreating] = useState(false);
    const [failed, setFailed] = useState<string | null>(null);
    const create = (): void => {
        if (creating) return;
        setCreating(true);
        setFailed(null);
        void createFirstTimeAccount().then((r) => {
            setCreating(false);
            if (r === 'expired') onExpired();
            else if (r === 'error') setFailed(CREATE_FAILED_COPY);
            else follow(r.redirect);
        });
    };
    return { creating, failed, create };
}

export function FirstTimePage(): JSX.Element {
    const [searchParams] = useSearchParams();
    const result = usePendingIdentity();
    const [expired, setExpired] = useState(false);
    const { creating, failed, create } = useCreate(() => setExpired(true));
    const invite = searchParams.get('invite');
    const keepInvite = (): void => { if (invite) safeSessionSetItem('invite_code', invite); };
    if (result === null) return <FirstTimeLoadingCard />;
    if (expired || result === 'expired') return <FirstTimeExpiredCard />;
    if (result === 'error') return <FirstTimeExpiredCard message={LOAD_FAILED_COPY} />;
    return (
        <FirstTimeChoiceCard view={result} preferExisting={lastUsedNames(result.otherMethod)}
            notice={firstTimeErrorCopy(searchParams.get('error'), result.provider, result.otherMethod)}
            creating={creating} createFailed={failed}
            onExisting={() => { keepInvite(); window.location.href = pendingLinkUrl(result.otherMethod); }}
            onCreate={() => { keepInvite(); create(); }} />
    );
}
