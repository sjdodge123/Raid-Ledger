/**
 * K1 Apple row (ROK-1598): "Apple iCloud · Uses an app-specific password ·
 * Connect" → the K3 sheet. Disabled with a hint when the server reports Apple
 * unavailable; it stays after a connect (Q15: several Apple IDs per user).
 */
import { useState, type JSX } from 'react';
import { Button } from '../../ui/button';
import { ProviderTile } from './CalendarProviderRow';
import { CALENDAR_ROW } from './calendar-sync-row';
import { APPLE_CONNECT_COPY as A } from './apple-connect.copy';
import { AppleConnectSheet } from './AppleConnectSheet';

/** `available` is `overview.providers.apple.available`; `another`: an Apple ID is already connected. */
export function AppleProviderRow({ available, another = false }: { available: boolean; another?: boolean }): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <div className={CALENDAR_ROW} data-testid="calendar-provider-apple">
            <ProviderTile label={A.tile} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{A.name}</p>
                <p className="text-xs text-muted" data-testid="calendar-provider-apple-hint">
                    {!available ? A.unavailable : another ? A.hintAnother : A.hint}
                </p>
            </div>
            <Button variant="secondary" disabled={!available} onClick={() => setOpen(true)}
                data-testid="calendar-connect-apple">
                {A.connect}
            </Button>
            <AppleConnectSheet isOpen={open} onClose={() => setOpen(false)} mode="connect" />
        </div>
    );
}
