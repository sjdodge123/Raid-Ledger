/**
 * One account's read on/off (ROK-1595 review r2). Read on/off is per
 * CONNECTION (`PATCH :id`, spec D1), so with two or more accounts that can
 * read, each card carries its own switch; the page's mode control stays once
 * per user. Its "Could not save" lives in this card's own state — the card is
 * keyed by connection id, so it cannot carry over to another account.
 */
import { useId, type JSX } from 'react';
import type { CalendarConnection } from '@raid-ledger/contract';
import { Switch } from '../../ui/switch';
import { useConnectionRead } from './use-read-rules';
import { CALENDARS_COPY as C, READ_COPY as R } from './calendar-sync.copy';

export function CalendarConnectionRead({ connection }: { connection: CalendarConnection }): JSX.Element {
    const subId = useId();
    const { toggle, failed, busy } = useConnectionRead(connection);
    return (
        <div data-testid="calendar-connection-read" data-connection-id={connection.id}>
            <div className="flex items-start justify-between gap-3 py-1.5">
                <div className="min-w-0">
                    <p className="text-sm text-foreground">{R.accountRead.title}</p>
                    <p id={subId} className="text-xs text-muted">{R.accountRead.sub}</p>
                </div>
                <Switch checked={connection.read.enabled} onChange={toggle} aria-describedby={subId}
                    label={R.accountRead.aria(connection.accountLabel ?? C.google.name)}
                    disabled={busy || connection.status === 'needs_reconnect'} />
            </div>
            {failed && <p role="alert" className="text-sm text-danger" data-testid="calendar-connection-read-error">{R.saveFailed}</p>}
        </div>
    );
}
