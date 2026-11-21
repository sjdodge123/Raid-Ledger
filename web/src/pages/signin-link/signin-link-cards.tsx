/**
 * ROK-2283 — the cards `/signin-link` renders: tap-to-continue, already signed
 * in, the used/expired link, and the loading / session-check states. Same
 * signed-out link-landing shell as `/h/:token` (`HubInviteShell`). Tokens only.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { buttonClass } from '../../components/ui/button-classes';
import { HubInviteShell } from '../hub-invite/hub-invite-cards';

export const DEAD_LINK_COPY = 'This link has already been used or has expired. Run /login in Discord for a new one.';
export const RETRY_COPY = 'Couldn’t sign you in just now. Check your connection and try again.';

export function SigninLinkLoadingCard(): JSX.Element {
    return (
        <HubInviteShell>
            <div className="h-16 bg-overlay rounded-lg animate-pulse" aria-hidden="true" />
            <p className="text-sm text-muted text-center">Opening sign-in link…</p>
        </HubInviteShell>
    );
}

export function SigninLinkDeadCard(): JSX.Element {
    return (
        <HubInviteShell>
            <div className="space-y-2 text-center" data-testid="signin-link-dead">
                <h1 className="text-base font-semibold text-foreground">Sign-in link not valid</h1>
                <p className="text-sm text-secondary" role="alert">{DEAD_LINK_COPY}</p>
            </div>
        </HubInviteShell>
    );
}

export function SigninLinkContinueCard({ community, displayName, pending, failed, onContinue }: {
    community: string; displayName: string | null; pending: boolean; failed: boolean; onContinue: () => void;
}): JSX.Element {
    return (
        <HubInviteShell>
            <div className="space-y-1 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">One-time sign-in link</p>
                <h1 className="text-lg font-semibold text-foreground" data-testid="signin-link-title">
                    Sign in to {community}{displayName ? <> as <span className="break-all">{displayName}</span></> : null}
                </h1>
                <p className="text-sm text-secondary">The link works once. Nothing happens until you tap Continue.</p>
            </div>
            <Button fullWidth size="lg" loading={pending} onClick={onContinue} data-testid="signin-link-continue">
                Continue
            </Button>
            {failed && <p role="alert" className="text-sm text-danger text-center">{RETRY_COPY}</p>}
        </HubInviteShell>
    );
}

export function SigninLinkSignedInCard({ username }: { username: string }): JSX.Element {
    return (
        <HubInviteShell>
            <div className="space-y-2 text-center" data-testid="signin-link-signed-in">
                <h1 className="text-base font-semibold text-foreground">You’re already signed in as {username}</h1>
                <p className="text-sm text-secondary">The link was not used. To switch accounts, sign out first and open a new link.</p>
                <Link to="/calendar" className={buttonClass({ variant: 'secondary', size: 'sm' })}>Go to Calendar</Link>
            </div>
        </HubInviteShell>
    );
}

export function SigninLinkSessionErrorCard({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <HubInviteShell>
            <div className="space-y-2 text-center" data-testid="signin-link-session-error">
                <p className="text-sm text-secondary" role="alert">Couldn’t check whether you’re already signed in.</p>
                <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
            </div>
        </HubInviteShell>
    );
}
