/**
 * Poll share page (ROK-1750) — route `/p/poll/:token`, public (outside AuthGuard).
 *
 * - Signed out: preview + Sign in with Discord. Clicking saves the token
 *   (`poll_share_token`) AND the auth redirect back here (D5).
 * - Signed in + onboarded (or admin): auto-join, then `replace`-navigate to the
 *   canonical poll page (+ "You've joined this poll." when newly joined).
 * - Signed in, not onboarded (non-admin): store the token, go to `/onboarding`
 *   (the wizard hands it back on finish) — never redeem here, or the poll page
 *   would bounce to onboarding and drop the destination.
 * - Unknown / reset token: one invalid-link card.
 */
import { useEffect, useRef, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth, isAdmin, type User } from '../hooks/use-auth';
import { usePollSharePreview, useJoinPollShare } from '../hooks/use-poll-share';
import { saveAuthRedirect } from '../lib/auth-redirect';
import { savePendingPollShare, pollSharePath, POLL_SHARE_TOKEN_KEY } from '../lib/poll-share-redirect';
import { AUTH_DISCORD_URL } from '../constants/api';
import { toast } from '../lib/toast';
import {
    PollSharePreviewCard, PollShareMessageCard, PollShareLoadingCard,
    INVALID_LINK_COPY, CANT_JOIN_COPY,
} from './poll-share/poll-share-cards';

function needsOnboarding(user: User): boolean {
    return !isAdmin(user) && !user.onboardingCompletedAt;
}

/** Signed-in: redeem once (or park the token for onboarding) and leave. */
function useRedeemOnArrival(token: string, user: User | null) {
    const navigate = useNavigate();
    const join = useJoinPollShare();
    const started = useRef(false);
    useEffect(() => {
        if (!user || started.current) return;
        started.current = true;
        if (needsOnboarding(user)) {
            savePendingPollShare(token);
            navigate('/onboarding', { replace: true });
            return;
        }
        join.mutate(token, {
            onSuccess: (res) => {
                sessionStorage.removeItem(POLL_SHARE_TOKEN_KEY);
                if (res.joined) toast.success("You've joined this poll.");
                navigate(`/community-lineup/${res.lineupId}/schedule/${res.matchId}`, { replace: true });
            },
            // A failed join (invalid link, deactivated) must not leave the
            // token parked for a later onboarding/login hand-back.
            onError: () => sessionStorage.removeItem(POLL_SHARE_TOKEN_KEY),
        });
    }, [user, token, navigate, join]);
    return join;
}

function startSignIn(token: string): void {
    savePendingPollShare(token);
    saveAuthRedirect(pollSharePath(token));
    window.location.href = AUTH_DISCORD_URL;
}

function PollShareContent({ token }: { token: string }): JSX.Element {
    const { user, isLoading: authLoading } = useAuth();
    const preview = usePollSharePreview(token);
    const join = useRedeemOnArrival(token, user);
    if (join.isError) return <PollShareMessageCard message={join.error.message.includes('no longer valid') ? INVALID_LINK_COPY : CANT_JOIN_COPY} />;
    if (authLoading || user) return <PollShareLoadingCard />;
    if (preview.isError) return <PollShareMessageCard message={INVALID_LINK_COPY} />;
    if (!preview.data) return <PollShareLoadingCard />;
    return <PollSharePreviewCard preview={preview.data} onSignIn={() => startSignIn(token)} />;
}

export function PollSharePage(): JSX.Element {
    const { token } = useParams<{ token: string }>();
    if (!token) return <PollShareMessageCard message={INVALID_LINK_COPY} />;
    return <PollShareContent token={token} />;
}
