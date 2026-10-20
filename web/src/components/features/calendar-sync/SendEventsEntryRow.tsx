/**
 * K2's "Add events I sign up for" row (ROK-1596 W1b): on phone it opens the
 * K5 "Send my events" page instead of carrying the settings inline. Desktop
 * keeps K4's inline card, so this row is phone-only (the caller decides).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import type { CalendarConnection } from '@raid-ledger/contract';
import { CALENDAR_ROW, sendEventsPath } from './calendar-sync-row';
import { PROVIDER_CALENDAR_NAME, SEND_EVENTS_COPY as S } from './calendar-sync.copy';

function entrySub({ provider, write }: CalendarConnection): string {
    if (!write.enabled) return S.entrySub.off;
    const calendar = PROVIDER_CALENDAR_NAME[provider];
    return write.target === 'primary' ? S.entrySub.primary(calendar) : S.entrySub.dedicated(calendar);
}

export function SendEventsEntryRow({ connection }: { connection: CalendarConnection }): JSX.Element {
    return (
        <Link to={sendEventsPath(connection.id)} data-testid="send-events-entry" data-connection-id={connection.id}
            className={`${CALENDAR_ROW} justify-between transition-colors hover:bg-overlay/40`}>
            <span className="min-w-0">
                <span className="block text-base text-foreground">{S.switchLabel}</span>
                <span className="block truncate text-xs text-muted">{entrySub(connection)}</span>
            </span>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        </Link>
    );
}
