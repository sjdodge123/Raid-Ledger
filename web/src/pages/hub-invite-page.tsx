/**
 * Hub invite landing (ROK-1893 P1) — route `/h/:token`, public (outside AuthGuard).
 *
 * - Dead link (expired / revoked / used up / hidden or proposed hub / unknown
 *   token): one card per reason + "Browse hubs".
 * - Signed out: preview + "Sign in with Discord to join"; the auth redirect
 *   brings them back here (same mechanism as `/p/poll/:token`).
 * - Signed in, not in the hub's Discord server (R2): "Join the Discord server
 *   first" with the bot-made server invite when there is one, else text only.
 * - Signed in, already a member: "Open hub". Otherwise Join → the hub page.
 */
import { useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { HubInvitePreview } from '@raid-ledger/contract';
import { useAuth } from '../hooks/use-auth';
import { saveAuthRedirect } from '../lib/auth-redirect';
import { AUTH_DISCORD_URL } from '../constants/api';
import { toast } from '../lib/toast';
import { tryEncodePathSegment } from '../lib/api/path-segment';
import { Button } from '../components/ui/button';
import { useHubInvitePreview, useJoinHubInvite } from '../components/hub/community/hub-invites-api';
import {
    DiscordFirstBlock, HubInviteCard, HubInviteDeadCard, HubInviteLoadingCard, type DeadReason,
} from './hub-invite/hub-invite-cards';
import { deadReasonFromError, hubInvitePath, hubPath } from './hub-invite/hub-invite-helpers';

function startSignIn(token: string): void {
    saveAuthRedirect(hubInvitePath(token));
    window.location.href = AUTH_DISCORD_URL;
}

function JoinAction({ token, preview, onRetry, retrying, onDead }: {
    token: string; preview: HubInvitePreview; onRetry: () => void; retrying: boolean; onDead: (r: DeadReason) => void;
}): JSX.Element {
    const navigate = useNavigate();
    const join = useJoinHubInvite();
    const hub = preview.hub;
    if (!hub) return <></>;
    if (preview.alreadyMember) {
        return <Button fullWidth onClick={() => navigate(hubPath(hub.id))} data-testid="hub-invite-open">Open {hub.name}</Button>;
    }
    if (preview.inDiscordServer === false) {
        return <DiscordFirstBlock inviteUrl={preview.discordServerInviteUrl} onRetry={onRetry} retrying={retrying} />;
    }
    const onJoin = (): void => join.mutate(token, {
        onSuccess: (res) => {
            if (res.joined) toast.success(`You joined ${hub.name}.`);
            navigate(hubPath(res.hubId), { replace: true });
        },
        onError: (err) => { const dead = deadReasonFromError(err); if (dead) onDead(dead); },
    });
    return (
        <div className="space-y-2">
            <Button fullWidth disabled={join.isPending} onClick={onJoin} data-testid="hub-invite-join">Join {hub.name}</Button>
            {join.isError && <p role="alert" className="text-sm text-danger">{join.error.message || 'Couldn’t join. Try again.'}</p>}
        </div>
    );
}

function HubInviteContent({ token }: { token: string }): JSX.Element {
    const { user, isLoading: authLoading } = useAuth();
    const preview = useHubInvitePreview(token);
    const [joinDead, setJoinDead] = useState<DeadReason | null>(null);
    if (joinDead) return <HubInviteDeadCard reason={joinDead} />;
    if (preview.isError) return <HubInviteDeadCard reason={deadReasonFromError(preview.error) ?? 'invalid'} />;
    if (authLoading || !preview.data) return <HubInviteLoadingCard />;
    const data = preview.data;
    if (data.state !== 'ok' || !data.hub) return <HubInviteDeadCard reason={data.state === 'ok' ? 'hub-unavailable' : data.state} />;
    return (
        <HubInviteCard hub={data.hub}>
            {user
                ? <JoinAction token={token} preview={data} onRetry={() => void preview.refetch()} retrying={preview.isFetching} onDead={setJoinDead} />
                : <Button fullWidth onClick={() => startSignIn(token)} data-testid="hub-invite-signin">Sign in with Discord to join</Button>}
        </HubInviteCard>
    );
}

export function HubInvitePage(): JSX.Element {
    const { token } = useParams<{ token: string }>();
    // A token that cannot be one path segment is never previewed or redeemed (ROK-1845 rule).
    if (!token || tryEncodePathSegment(token) === null) return <HubInviteDeadCard reason="invalid" />;
    return <HubInviteContent token={token} />;
}
