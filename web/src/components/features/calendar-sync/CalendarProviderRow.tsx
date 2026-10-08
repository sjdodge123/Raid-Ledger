/**
 * K1 provider row (ROK-1594): "Google Calendar · Sign in with Google · Connect".
 * Only Google ships in this phase; the other K1 rows stay hidden until their
 * stories (spec Q13). When the server has no Google client configured the
 * row stays, with Connect disabled and an admin hint.
 */
import type { JSX } from 'react';
import { Button } from '../../ui/button';
import { useStartGoogleConnect } from '../../../hooks/use-calendar-sync';
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

/** Google's K1 row; `available` is `overview.providers.google.available`. */
export function CalendarProviderRow({ available }: { available: boolean }): JSX.Element {
    const start = useStartGoogleConnect();
    return (
        <div className={CALENDAR_ROW} data-testid="calendar-provider-google">
            <ProviderTile label={C.google.tile} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{C.google.name}</p>
                <p className="text-xs text-muted" data-testid="calendar-provider-google-hint">
                    {available ? C.google.hint : C.google.notConfigured}
                </p>
                {start.isError && <p role="alert" className="text-xs text-danger">{C.google.startFailed}</p>}
            </div>
            <Button variant="secondary" disabled={!available} loading={start.isPending}
                loadingLabel={C.google.connecting} onClick={() => start.mutate()}
                data-testid="calendar-connect-google">
                {C.google.connect}
            </Button>
        </div>
    );
}
