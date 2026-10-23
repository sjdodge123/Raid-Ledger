/**
 * ROK-1893 P1 — the cards `/h/:token` renders (approved wireframe
 * `hub-community-wireframes/InviteFrames.tsx` → RedeemCard): "You're invited"
 * with the hub preview and one action, the "Join the Discord server first"
 * block, and the dead-link card. Same shell as the poll share page. Tokens only.
 */
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { HubInvitePreview, HubInviteState } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { buttonClass } from '../../components/ui/button-classes';
import { useDiscordLinkAction } from '../../hooks/use-discord-link';

type PreviewHub = NonNullable<HubInvitePreview['hub']>;

export function HubInviteShell({ children }: { children: ReactNode }): JSX.Element {
    return (
        <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md rounded-xl bg-surface border border-edge p-6 space-y-4">{children}</div>
        </div>
    );
}

export function HubInviteLoadingCard(): JSX.Element {
    return (
        <HubInviteShell>
            <div className="h-16 bg-overlay rounded-lg animate-pulse" aria-hidden="true" />
            <p className="text-sm text-muted text-center">Opening invite…</p>
        </HubInviteShell>
    );
}

const DEAD_COPY: Record<Exclude<HubInviteState, 'ok'> | 'invalid', { title: string; body: string }> = {
    expired: { title: 'This invite link has expired', body: 'Ask a hub member for a new link.' },
    revoked: { title: 'This invite link was revoked', body: 'Ask a hub member for a new link.' },
    exhausted: { title: 'This invite link has been used up', body: 'Ask a hub member for a new link.' },
    'hub-unavailable': { title: 'This invite link doesn’t work', body: 'The hub may be hidden or not approved yet.' },
    invalid: { title: 'This invite link doesn’t work', body: 'Check the link, or ask a hub member for a new one.' },
};

export type DeadReason = keyof typeof DEAD_COPY;

export function HubInviteDeadCard({ reason }: { reason: DeadReason }): JSX.Element {
    const copy = DEAD_COPY[reason];
    return (
        <HubInviteShell>
            <div className="space-y-2 text-center" data-testid="hub-invite-dead">
                <p className="text-base font-semibold text-foreground" role="alert">{copy.title}</p>
                <p className="text-sm text-secondary">{copy.body}</p>
                <Link to="/hubs" className={buttonClass({ variant: 'secondary', size: 'sm' })}>Browse hubs</Link>
            </div>
        </HubInviteShell>
    );
}

function HubPreviewRow({ hub }: { hub: PreviewHub }): JSX.Element {
    const meta = [hub.gameName, `${hub.memberCount} ${hub.memberCount === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ');
    return (
        <div className="flex items-center gap-3">
            {hub.gameCoverUrl
                ? <img src={hub.gameCoverUrl} alt="" className="h-16 w-12 shrink-0 rounded-md object-cover" />
                : <div className="h-16 w-12 shrink-0 rounded-md bg-panel" aria-hidden="true" />}
            <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-foreground">{hub.name}</h1>
                <p className="text-xs text-muted">{meta}</p>
                {hub.blurb && <p className="mt-1 text-sm text-secondary">{hub.blurb}</p>}
            </div>
        </div>
    );
}

export function HubInviteCard({ hub, children }: { hub: PreviewHub; children: ReactNode }): JSX.Element {
    return (
        <HubInviteShell>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">You&apos;re invited</p>
            <HubPreviewRow hub={hub} />
            {children}
        </HubInviteShell>
    );
}

const DISCORD_FIRST_NOTE = "Hub members have to be in the community's Discord server. Join it, then come back to this link.";
const LINK_DISCORD_NOTE = "Hub members have to be in the community's Discord server, so your account needs Discord linked. Link it, then come back to this link.";

/**
 * Signed in but not in the hub's Discord server (R2): join there first, then
 * retry. `note` overrides the landing-page copy (the event page's join prompt).
 */
export function DiscordFirstBlock({ inviteUrl, onRetry, retrying, note = DISCORD_FIRST_NOTE }: {
    inviteUrl: string | null; onRetry: () => void; retrying: boolean; note?: string;
}): JSX.Element {
    return (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3" data-testid="hub-invite-discord-first">
            <p className="text-sm font-semibold text-foreground">Join the Discord server first</p>
            <p className="text-xs text-secondary">{note}</p>
            <div className="flex flex-wrap gap-2">
                {inviteUrl && (
                    <a href={inviteUrl} target="_blank" rel="noopener noreferrer" data-testid="hub-invite-discord-link"
                        className={buttonClass({ variant: 'primary', size: 'sm' })}>Open the Discord invite</a>
                )}
                <Button variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>I&apos;ve joined — try again</Button>
            </div>
        </div>
    );
}

/** Signed in without a linked Discord account: hub membership is checked by Discord id. */
export function LinkDiscordFirstBlock({ note = LINK_DISCORD_NOTE }: { note?: string } = {}): JSX.Element {
    const { linkDiscord, isPending } = useDiscordLinkAction();
    return (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3" data-testid="hub-invite-link-discord">
            <p className="text-sm font-semibold text-foreground">Link your Discord account first</p>
            <p className="text-xs text-secondary">{note}</p>
            <Button variant="primary" size="sm" disabled={isPending} onClick={linkDiscord}>Link Discord</Button>
        </div>
    );
}
