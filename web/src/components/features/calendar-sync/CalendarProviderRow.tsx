/**
 * K1 OAuth provider row (ROK-1594, generalised for Outlook in ROK-1597):
 * "Google Calendar · Sign in with Google · Connect" and "Outlook / Microsoft
 * 365 · Sign in with Microsoft · Connect". When the server has no client
 * configured the Google row stays, with Connect disabled and an admin hint;
 * the Outlook row is not rendered at all then (ROK-1597 §8 Q8 — the caller
 * gates it). Either row stays once an account is connected (Q15: several
 * accounts per provider).
 */
import type { JSX } from 'react';
import type { CalendarOAuthReturn } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useStartOAuth, type OAuthCalendarProvider } from '../../../hooks/use-calendar-sync';
import { CALENDARS_COPY as C } from './calendar-sync.copy';
import { CALENDAR_ROW } from './calendar-sync-row';

/** The square monogram tile at the start of a provider row. */
export function ProviderTile({ label }: { label: string }): JSX.Element {
    return (
        <span aria-hidden="true"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-overlay text-sm font-semibold text-foreground">
            {label}
        </span>
    );
}

function rowHint(provider: OAuthCalendarProvider, available: boolean, another: boolean): string {
    const copy = C[provider];
    if (!available) return copy.notConfigured;
    return another ? copy.hintAnother : copy.hint;
}

/**
 * An OAuth provider's K1 row; `available` is `overview.providers[provider].available`.
 * `another`: an account is already connected, so the row offers a further one.
 * `returnTarget`: where the OAuth callback lands — the wizard passes `'onboarding'` (ROK-2022).
 * Test ids are `calendar-provider-<provider>`, `…-hint` and `calendar-connect-<provider>`.
 */
export function CalendarProviderRow({ provider = 'google', available, another = false, returnTarget }: {
    provider?: OAuthCalendarProvider; available: boolean; another?: boolean; returnTarget?: CalendarOAuthReturn;
}): JSX.Element {
    const start = useStartOAuth('connect', returnTarget, provider);
    const copy = C[provider];
    return (
        <div className={CALENDAR_ROW} data-testid={`calendar-provider-${provider}`}>
            <ProviderTile label={copy.tile} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{copy.name}</p>
                <p className="text-xs text-muted" data-testid={`calendar-provider-${provider}-hint`}>
                    {rowHint(provider, available, another)}
                </p>
                {start.isError && <p role="alert" className="text-xs text-danger">{copy.startFailed}</p>}
            </div>
            <Button variant="secondary" disabled={!available} loading={start.isPending}
                loadingLabel={copy.connecting} onClick={() => start.mutate()}
                data-testid={`calendar-connect-${provider}`}>
                {copy.connect}
            </Button>
        </div>
    );
}
