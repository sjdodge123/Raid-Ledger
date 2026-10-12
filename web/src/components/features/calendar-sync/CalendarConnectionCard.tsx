/**
 * K2/K4 connected row: "Google Calendar" over its status, with Manage.
 * Status (ROK-1595): "Synced 4 min ago · 2 calendars" (phone) / "Synced 4 min
 * ago" (desktop) once a sync has run, else "Connected · <email>" (ROK-1594).
 * A revoked grant (`needs_reconnect`) turns the line red — "Access was
 * revoked · reconnect" — and adds "Fix", which re-runs the Google consent.
 * From 1024px the K4 "Calendars to check" picker sits under the row. With two
 * or more accounts that can read, the card also carries this account's read
 * on/off (`readSwitch`); one account is switched by the page's read rules (F-2).
 */
import type { JSX } from 'react';
import type { CalendarConnection } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useStartOAuth } from '../../../hooks/use-calendar-sync';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { ProviderTile } from './CalendarProviderRow';
import { CALENDAR_ROW } from './calendar-sync-row';
import { CalendarManageMenu } from './CalendarManageMenu';
import { CalendarPicker } from './CalendarPicker';
import { CalendarConnectionRead } from './CalendarConnectionRead';
import { readGranted } from './use-read-rules';
import { CALENDARS_COPY as C, READ_COPY as R, readStatusLine } from './calendar-sync.copy';

const TONE: Record<CalendarConnection['status'], string> = {
    active: 'text-success', needs_reconnect: 'text-danger', error: 'text-warning', disconnecting: 'text-warning',
};

function FixButton(): JSX.Element {
    const fix = useStartOAuth('connect');
    return (
        <Button variant="secondary" loading={fix.isPending} loadingLabel={R.granting} onClick={() => fix.mutate()}
            aria-label={R.fix} data-testid="calendar-connection-fix">
            {R.fix}
        </Button>
    );
}

interface CardProps { connection: CalendarConnection; readSwitch?: boolean }

export function CalendarConnectionCard({ connection, readSwitch = false }: CardProps): JSX.Element {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const broken = connection.status === 'needs_reconnect';
    const showPicker = desktop && !broken && connection.read.enabled && readGranted(connection);
    return (
        <div className="space-y-3">
            <div className={CALENDAR_ROW} data-testid="calendar-connection-card" data-connection-id={connection.id}>
                <ProviderTile label={C.google.tile} />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{C.google.name}</p>
                    <p className={`truncate text-xs ${TONE[connection.status]}`} data-testid="calendar-connection-status">
                        {readStatusLine(connection, desktop)}
                    </p>
                </div>
                {broken && <FixButton />}
                <CalendarManageMenu connection={connection} />
            </div>
            {readSwitch && readGranted(connection) && <CalendarConnectionRead connection={connection} />}
            {showPicker && <CalendarPicker connection={connection} />}
        </div>
    );
}
