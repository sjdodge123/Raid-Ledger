/**
 * Read rules for one connection (ROK-1595 K2/K4). The read MODE is per user
 * (`PUT settings`), read on/off is per connection (`PATCH :id`) — spec D1.
 * Phone shows the mode as two switches; both off turns reading off for the
 * connection (operator ruling F-2). Desktop picks one of three modes. Every
 * change saves at once; the hooks patch the overview optimistically and put
 * it back on an error (D3), and the section shows "Could not save".
 */
import { useState } from 'react';
import type { CalendarConnection, CalendarReadMode, ProviderCalendar } from '@raid-ledger/contract';
import { useSetReadEnabled, useUpdateReadSettings } from '../../../hooks/use-calendar-read';

export interface ReadSwitches { days: boolean; hours: boolean }

/** True when the stored grant covers reading (a missing `readAccess` is a pre-1593 payload). */
export function readGranted(c: Pick<CalendarConnection, 'readAccess' | 'errorCode'>): boolean {
    return c.readAccess !== 'missing' && c.errorCode !== 'read_scopes';
}

/** The ids being read: the stored list, or the primary calendar when it is empty. */
export function checkedIds(stored: readonly string[], calendars: readonly ProviderCalendar[]): string[] {
    if (stored.length > 0) return [...stored];
    return calendars.filter((c) => c.primary).map((c) => c.id);
}

/** The list the picker shows: everything but the dedicated Raid Ledger calendar. */
export function pickable(calendars: readonly ProviderCalendar[]): ProviderCalendar[] {
    return calendars.filter((c) => !c.isRaidLedger);
}

/** The two K2 switches for a mode; both off while reading is off on the connection. */
export function switchesOf(mode: CalendarReadMode, enabled: boolean): ReadSwitches {
    if (!enabled) return { days: false, hours: false };
    return { days: mode !== 'hours', hours: mode !== 'days' };
}

/** The mode two switches mean, or null when both are off (F-2: read off). */
export function modeOf(s: ReadSwitches): CalendarReadMode | null {
    if (s.days && s.hours) return 'both';
    if (s.days) return 'days';
    return s.hours ? 'hours' : null;
}

/** The writes one read choice needs: turn reading on/off, and/or set the mode. */
export interface ReadChange { enabled?: boolean; mode?: CalendarReadMode }

/** What picking `next` (a mode, or null = off) changes from the current state. */
export function readChangeFor(next: CalendarReadMode | null, mode: CalendarReadMode, enabled: boolean): ReadChange {
    if (next === null) return enabled ? { enabled: false } : {};
    const change: ReadChange = {};
    if (!enabled) change.enabled = true;
    if (next !== mode) change.mode = next;
    return change;
}

/** Applies a `ReadChange`: PATCH read on first (the mode only counts once it is on), then PUT the mode. */
export function useReadRules(connection: CalendarConnection, mode: CalendarReadMode) {
    const setEnabled = useSetReadEnabled();
    const setMode = useUpdateReadSettings();
    const [failed, setFailed] = useState(false);
    const onError = (): void => setFailed(true);
    const putMode = (next: CalendarReadMode | undefined): void => {
        if (next) setMode.mutate(next, { onError });
    };
    const choose = (next: CalendarReadMode | null): void => {
        setFailed(false);
        const change = readChangeFor(next, mode, connection.read.enabled);
        if (change.enabled === undefined) return putMode(change.mode);
        setEnabled.mutate({ id: connection.id, enabled: change.enabled }, {
            onError,
            onSuccess: () => putMode(change.mode),
        });
    };
    const busy = setEnabled.isPending || setMode.isPending;
    return { choose, failed, busy, enabled: connection.read.enabled };
}
