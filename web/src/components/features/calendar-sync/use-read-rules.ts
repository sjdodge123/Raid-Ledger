/**
 * Read rules (ROK-1595 K2/K4). The read MODE is per user (`PUT settings`) and
 * renders once on the page; read on/off and the picked calendars are per
 * connection (`PATCH :id`) — spec D1. Phone shows the mode as two switches;
 * both off turns reading off (operator ruling F-2) on every account that
 * reads. Desktop picks one of three modes. With two or more readable accounts
 * each card also carries its own on/off. Every change saves at once; the hooks
 * patch the overview optimistically and put it back on an error (D3), and the
 * section shows "Could not save".
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

/** Connections whose read rules apply: not being disconnected, and granted read. */
export function readableConnections(connections: readonly CalendarConnection[]): CalendarConnection[] {
    return connections.filter((c) => c.status !== 'disconnecting' && readGranted(c));
}

/** The connections a page-level on/off touches: those not already in the target state. */
export function enabledTargets(readable: readonly CalendarConnection[], enabled: boolean): CalendarConnection[] {
    return readable.filter((c) => c.read.enabled !== enabled);
}

/**
 * The page-level mode control. "On" = at least one readable account reads.
 * Applies a `ReadChange`: PATCH read on/off on every account it touches first
 * (the mode only counts once reading is on), then PUT the mode.
 */
export function useReadMode(readable: readonly CalendarConnection[], mode: CalendarReadMode) {
    const setEnabled = useSetReadEnabled();
    const setMode = useUpdateReadSettings();
    const [failed, setFailed] = useState(false);
    const onError = (): void => setFailed(true);
    const enabled = readable.some((c) => c.read.enabled);
    const putMode = (next: CalendarReadMode | undefined): void => {
        if (next) setMode.mutate(next, { onError });
    };
    const choose = (next: CalendarReadMode | null): void => {
        setFailed(false);
        const change = readChangeFor(next, mode, enabled);
        const on = change.enabled;
        if (on === undefined) return putMode(change.mode);
        const writes = enabledTargets(readable, on).map((c) => setEnabled.mutateAsync({ id: c.id, enabled: on }));
        void Promise.all(writes).then(() => putMode(change.mode), onError);
    };
    const busy = setEnabled.isPending || setMode.isPending;
    return { choose, failed, busy, enabled };
}

/** One account's read on/off (the per-card switch); its error stays on its own card. */
export function useConnectionRead(connection: CalendarConnection) {
    const setEnabled = useSetReadEnabled();
    const [failed, setFailed] = useState(false);
    const toggle = (on: boolean): void => {
        setFailed(false);
        setEnabled.mutate({ id: connection.id, enabled: on }, { onError: () => setFailed(true) });
    };
    return { toggle, failed, busy: setEnabled.isPending };
}
