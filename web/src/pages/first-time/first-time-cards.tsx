/**
 * ROK-2371 D1(a): the `/auth/first-time` cards — the choice, the expired
 * sign-in and the loading state. Same signed-out link-landing shell and card
 * idioms as `/signin-link` (`signin-link-cards.tsx`); there is no `ui/Card`.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { PendingIdentityViewDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { buttonClass } from '../../components/ui/button-classes';
import { HubInviteShell } from '../hub-invite/hub-invite-cards';
import { CREATE_LABEL, EXPIRED_COPY, FIRST_TIME_HEADING, existingLabel, providerName } from './first-time-copy';

export function FirstTimeLoadingCard(): JSX.Element {
    return (
        <HubInviteShell>
            <div className="h-16 bg-overlay rounded-lg animate-pulse" aria-hidden="true" />
            <p className="text-sm text-muted text-center">Checking your sign-in…</p>
        </HubInviteShell>
    );
}

/** No live pending identity (expired, spent, or another browser). */
export function FirstTimeExpiredCard({ message = EXPIRED_COPY }: { message?: string }): JSX.Element {
    return (
        <HubInviteShell>
            <div className="space-y-3 text-center" data-testid="first-time-expired">
                <h1 className="text-base font-semibold text-foreground">Sign-in not finished</h1>
                <p className="text-sm text-secondary" role="alert">{message}</p>
                <Link to="/" className={buttonClass({ variant: 'secondary', size: 'sm' })}>Back to sign in</Link>
            </div>
        </HubInviteShell>
    );
}

export interface FirstTimeChoiceProps {
    view: PendingIdentityViewDto;
    /** The browser's last-used marker names `view.otherMethod`: that option is primary. */
    preferExisting: boolean;
    /** A `?error=` message (e.g. "We couldn't find an account for that one either"). */
    notice: string | null;
    creating: boolean;
    createFailed: string | null;
    onExisting: () => void;
    onCreate: () => void;
}

/** The two choices: add this sign-in to an existing account, or create one. */
export function FirstTimeChoiceCard(props: FirstTimeChoiceProps): JSX.Element {
    const { view, preferExisting } = props;
    return (
        <HubInviteShell>
            <div className="space-y-1 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Signed in with {providerName(view.provider)}</p>
                <h1 className="text-lg font-semibold text-foreground" data-testid="first-time-title">{FIRST_TIME_HEADING}</h1>
                <p className="text-sm text-secondary">
                    There’s no Raid Ledger account for <span className="break-words font-medium text-foreground">{view.displayName}</span> yet.
                </p>
            </div>
            {props.notice && <p role="alert" className="text-sm text-danger text-center" data-testid="first-time-notice">{props.notice}</p>}
            <div className="space-y-2">
                <Button fullWidth size="lg" variant={preferExisting ? 'primary' : 'secondary'} onClick={props.onExisting}
                    data-testid="first-time-existing" data-primary={preferExisting ? 'true' : 'false'}>
                    {existingLabel(view.otherMethod)}
                </Button>
                <p className="text-xs text-muted text-center">
                    Sign in with {providerName(view.otherMethod)} and we’ll add this {providerName(view.provider)} sign-in to that account.
                </p>
            </div>
            <Button fullWidth size="lg" variant={preferExisting ? 'secondary' : 'primary'} onClick={props.onCreate}
                loading={props.creating} data-testid="first-time-create" data-primary={preferExisting ? 'false' : 'true'}>
                {CREATE_LABEL}
            </Button>
            {props.createFailed && <p role="alert" className="text-sm text-danger text-center">{props.createFailed}</p>}
        </HubInviteShell>
    );
}
