/**
 * K2 connected row (ROK-1594): "Google Calendar" over "Connected · <email>",
 * with Manage. "Synced N min ago" replaces the status line once read sync
 * ships; until then the account email is what tells two accounts apart.
 */
import type { JSX } from 'react';
import type { CalendarConnection } from '@raid-ledger/contract';
import { ProviderTile } from './CalendarProviderRow';
import { CALENDAR_ROW } from './calendar-sync-row';
import { CalendarManageMenu } from './CalendarManageMenu';
import { CALENDARS_COPY as C, connectionStatusLine } from './calendar-sync.copy';

export function CalendarConnectionCard({ connection }: { connection: CalendarConnection }): JSX.Element {
    const tone = connection.status === 'active' ? 'text-success' : 'text-warning';
    return (
        <div className={CALENDAR_ROW} data-testid="calendar-connection-card" data-connection-id={connection.id}>
            <ProviderTile label={C.google.tile} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{C.google.name}</p>
                <p className={`truncate text-xs ${tone}`} data-testid="calendar-connection-status">
                    {connectionStatusLine(connection)}
                </p>
            </div>
            <CalendarManageMenu connection={connection} />
        </div>
    );
}
