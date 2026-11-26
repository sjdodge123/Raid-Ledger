/**
 * ROK-2283 — `/signin-link`, public (outside AuthGuard): the landing for the
 * Discord `/login` command's one-time link.
 *
 * The token was stripped from `#token=` at module load (magic-link-capture) and
 * held — NOT auto-redeemed — so opening the link in Discord's in-app browser
 * spends nothing. The page reads the token's display claims (unverified; the
 * server is the authority) and waits for Continue:
 * - Continue → redeem at the endpoint for the token's kind → Calendar
 *   (AuthGuard sends a brand-new member on to /onboarding).
 * - Already signed in → keep that session, leave the link unspent (login-CSRF
 *   rule, matches magic-link-redeem's OQ6).
 * - Used / expired / unreadable → the dead-link card.
 */
import { useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useSystemStatus } from '../hooks/use-system-status';
import { clearCapturedSigninLinkToken, peekCapturedSigninLinkToken } from '../lib/magic-link-capture';
import { readSigninLinkClaims, type SigninLinkClaims } from '../lib/signin-link-token';
import { redeemSigninLink } from '../lib/signin-link-redeem';
import { recordLastSignin } from '../lib/last-signin';
import {
    SigninLinkContinueCard, SigninLinkDeadCard, SigninLinkLoadingCard, SigninLinkSessionErrorCard, SigninLinkSignedInCard,
} from './signin-link/signin-link-cards';

type Phase = 'idle' | 'pending' | 'dead' | 'retry';

function useContinue(token: string, claims: SigninLinkClaims) {
    const navigate = useNavigate();
    const { refetch } = useAuth();
    const [phase, setPhase] = useState<Phase>('idle');
    const onContinue = async (): Promise<void> => {
        if (phase === 'pending') return;
        setPhase('pending');
        const outcome = await redeemSigninLink(token, claims.kind);
        if (outcome !== 'retry') clearCapturedSigninLinkToken();
        if (outcome !== 'ok') { setPhase(outcome); return; }
        const { data: user } = await refetch();
        if (user) recordLastSignin('discord-app-code', user);
        navigate('/calendar', { replace: true });
    };
    return { phase, onContinue: () => void onContinue() };
}

function SigninLinkContent({ token, claims }: { token: string; claims: SigninLinkClaims }): JSX.Element {
    const { user, isLoading, error, refetch } = useAuth();
    const { data: status } = useSystemStatus();
    const { phase, onContinue } = useContinue(token, claims);
    if (phase === 'dead') return <SigninLinkDeadCard />;
    if (isLoading) return <SigninLinkLoadingCard />;
    if (user && phase !== 'pending') return <SigninLinkSignedInCard username={user.username} />;
    if (error && phase !== 'pending') return <SigninLinkSessionErrorCard onRetry={() => void refetch()} />;
    return (
        <SigninLinkContinueCard
            community={status?.communityName || 'Raid Ledger'}
            displayName={claims.displayName}
            pending={phase === 'pending'}
            failed={phase === 'retry'}
            onContinue={onContinue}
        />
    );
}

export function SigninLinkPage(): JSX.Element {
    const [token] = useState(() => peekCapturedSigninLinkToken());
    const claims = useMemo(() => (token ? readSigninLinkClaims(token) : null), [token]);
    if (!token || !claims) return <SigninLinkDeadCard />;
    return <SigninLinkContent token={token} claims={claims} />;
}
