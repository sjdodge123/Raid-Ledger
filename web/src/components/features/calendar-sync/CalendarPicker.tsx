/**
 * "Calendars to check" (ROK-1595 K4): one checkbox per calendar in the
 * connected account. Our own dedicated "Raid Ledger" calendar is never
 * listed — reading it back would make your sign-ups clash with themselves
 * (S4). An empty `calendarIds` means "primary only", so the primary row shows
 * checked. The last checked calendar cannot be unchecked; turning reading
 * off is the read rules' job. Each tick saves at once (PATCH, optimistic).
 */
import { useState, type JSX } from 'react';
import type { CalendarConnection, ProviderCalendar } from '@raid-ledger/contract';
import { Checkbox } from '../../ui/checkbox';
import { useProviderCalendars, useSetReadCalendars } from '../../../hooks/use-calendar-read';
import { calendarReadErrorOf } from '../../../hooks/calendar-read.helpers';
import { checkedIds, pickable } from './use-read-rules';
import { READ_COPY as R } from './calendar-sync.copy';

function Status({ text, alert = false }: { text: string; alert?: boolean }): JSX.Element {
    return <p role={alert ? 'alert' : undefined} className={`text-sm ${alert ? 'text-danger' : 'text-muted'}`}>{text}</p>;
}

interface ListProps { connection: CalendarConnection; calendars: ProviderCalendar[] }

function PickerList({ connection, calendars }: ListProps): JSX.Element {
    const save = useSetReadCalendars();
    const [failed, setFailed] = useState(false);
    const checked = checkedIds(connection.read.calendarIds, calendars);
    const toggle = (id: string, on: boolean): void => {
        setFailed(false);
        const calendarIds = on ? [...checked, id] : checked.filter((c) => c !== id);
        save.mutate({ id: connection.id, calendarIds }, { onError: () => setFailed(true) });
    };
    if (calendars.length === 0) return <Status text={R.pickerEmpty} />;
    return (
        <div className="flex flex-col">
            {calendars.map((c) => {
                const on = checked.includes(c.id);
                return (
                    <Checkbox key={c.id} label={c.name} checked={on} data-testid="calendar-picker-option" data-calendar-id={c.id}
                        disabled={save.isPending || (on && checked.length === 1)} onChange={(e) => toggle(c.id, e.target.checked)} />
                );
            })}
            {failed && <Status text={R.saveFailed} alert />}
        </div>
    );
}

/** The picker for one connection; `heading` false when a sheet title already names it. */
export function CalendarPicker({ connection, heading = true }: { connection: CalendarConnection; heading?: boolean }): JSX.Element {
    const query = useProviderCalendars(connection.id);
    const kind = calendarReadErrorOf(query.error);
    return (
        <div className="space-y-1" data-testid="calendar-picker" data-connection-id={connection.id}>
            {heading && <p className="text-xs font-medium text-secondary">{R.pickerLabel}</p>}
            {query.isLoading && <Status text={R.pickerLoading} />}
            {kind === 'read_scopes' && <Status text={R.grantTitle} />}
            {kind !== null && kind !== 'read_scopes' && <Status text={R.pickerError} alert />}
            {query.data && <PickerList connection={connection} calendars={pickable(query.data)} />}
        </div>
    );
}
