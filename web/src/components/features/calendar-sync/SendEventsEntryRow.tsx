/**
 * K2's "Add events I sign up for" row (ROK-1596 W1b): on phone it opens the
 * K5 "Send my events" page instead of carrying the settings inline. Desktop
 * keeps K4's inline card, so this row is phone-only (the caller decides).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import type { CalendarConnection } from '@raid-ledger/contract';
import { CALENDARS_PATH } from '../../profile/profile-nav-data';
import { SEND_EVENTS_COPY as S } from './calendar-sync.copy';

/** `/profile/gaming/calendars/send/:connectionId`. */
export function sendEventsPath(connectionId: string): string {
    return `${CALENDARS_PATH}/send/${connectionId}`;
}

function entrySub(write: CalendarConnection['write']): string {
    if (!write.enabled) return S.entrySub.off;
    return write.target === 'primary' ? S.entrySub.primary : S.entrySub.dedicated;
}

export function SendEventsEntryRow({ connection }: { connection: CalendarConnection }): JSX.Element {
    return (
        <Link to={sendEventsPath(connection.id)} data-testid="send-events-entry" data-connection-id={connection.id}
            className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-edge-subtle bg-surface p-4 transition-colors hover:bg-overlay/40">
            <span className="min-w-0">
                <span className="block text-base text-foreground">{S.switchLabel}</span>
                <span className="block truncate text-xs text-muted">{entrySub(connection.write)}</span>
            </span>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
        </Link>
    );
}
