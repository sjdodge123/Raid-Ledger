/**
 * K2/K4 connected row: "Google Calendar" over its status, with Manage.
 * Status (ROK-1595): "Synced 4 min ago · 2 calendars" (phone) / "Synced 4 min
 * ago" (desktop) once a sync has run, else "Connected · <email>" (ROK-1594).
 * A revoked grant (`needs_reconnect`) turns the line red — "Access was
 * revoked · reconnect" — and adds "Fix", which re-runs the Google consent.
 * From 1024px the K4 "Calendars to check" picker sits under the row. With two
 * or more accounts that can read, the card also carries this account's read
 * on/off (`readSwitch`); one account is switched by the page's read rules (F-2).
 * An account without read access while another account reads (`anyReadable`)
 * shows "Grant read access" on its own card (spec §4) — when none reads, the
 * read-rules section carries that CTA instead. With two or more Google
 * connections the account email sits under the title (`showAccount`, R3).
 *
 * ROK-1598: tile + title come from `PROVIDER_DISPLAY`. An Apple card's Fix
 * reopens the K3 sheet in `reconnect` mode (its line reads "Password was
 * revoked · reconnect"), and it never offers "Grant read access" — an
 * app-specific password always reads.
 */
import { useState, type JSX } from 'react';
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
import { GrantRead } from './CalendarGrantRead';
import { AppleConnectSheet } from './AppleConnectSheet';
import { PROVIDER_DISPLAY, READ_COPY as R, readStatusLine } from './calendar-sync.copy';

const TONE: Record<CalendarConnection['status'], string> = {
    active: 'text-success', needs_reconnect: 'text-danger', error: 'text-warning', disconnecting: 'text-warning',
};

function GoogleFixButton(): JSX.Element {
    const fix = useStartOAuth('connect');
    return (
        <Button variant="secondary" loading={fix.isPending} loadingLabel={R.granting} onClick={() => fix.mutate()}
            aria-label={R.fix} data-testid="calendar-connection-fix">
            {R.fix}
        </Button>
    );
}

function AppleFixButton({ connection }: { connection: CalendarConnection }): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="secondary" onClick={() => setOpen(true)} aria-label={R.fix} data-testid="calendar-connection-fix">
                {R.fix}
            </Button>
            <AppleConnectSheet isOpen={open} onClose={() => setOpen(false)} mode="reconnect" connection={connection} />
        </>
    );
}

function FixButton({ connection }: { connection: CalendarConnection }): JSX.Element {
    return connection.provider === 'apple' ? <AppleFixButton connection={connection} /> : <GoogleFixButton />;
}

/** "Grant read access" applies to a live Google grant without read; an Apple password always reads. */
function offersGrant(connection: CalendarConnection): boolean {
    return connection.provider !== 'apple' && connection.status !== 'disconnecting' && !readGranted(connection);
}

interface CardProps {
    connection: CalendarConnection; readSwitch?: boolean; anyReadable?: boolean;
    /** 2+ connections of this provider: the account email sits under the title (operator R3). */
    showAccount?: boolean;
}

export function CalendarConnectionCard({ connection, readSwitch = false, anyReadable = false, showAccount = false }: CardProps): JSX.Element {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const broken = connection.status === 'needs_reconnect';
    const showPicker = desktop && !broken && connection.read.enabled && readGranted(connection);
    const showGrant = anyReadable && !broken && offersGrant(connection);
    const display = PROVIDER_DISPLAY[connection.provider];
    // The account line already names the email; keep it out of the "Connected · <email>" fallback.
    const statusInput = showAccount ? { ...connection, accountLabel: null } : connection;
    return (
        <div className="space-y-3">
            <div className={CALENDAR_ROW} data-testid="calendar-connection-card" data-connection-id={connection.id}
                data-provider={connection.provider}>
                <ProviderTile label={display.tile} />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground" data-testid="calendar-connection-name">{display.name}</p>
                    {showAccount && connection.accountLabel && (
                        <p className="truncate text-xs text-muted" data-testid="calendar-connection-account">{connection.accountLabel}</p>
                    )}
                    <p className={`truncate text-xs ${TONE[connection.status]}`} data-testid="calendar-connection-status">
                        {readStatusLine(statusInput, desktop)}
                    </p>
                </div>
                {broken && <FixButton connection={connection} />}
                <CalendarManageMenu connection={connection} />
            </div>
            {readSwitch && readGranted(connection) && <CalendarConnectionRead connection={connection} />}
            {showGrant && <GrantRead />}
            {showPicker && <CalendarPicker connection={connection} />}
        </div>
    );
}
