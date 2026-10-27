/**
 * ROK-2022: whether the first-run wizard shows its Calendar step (after Game
 * Time). Shown only when the calendar-sync kill switch is on, a shipped
 * provider (Google or Apple) is available, and the user has no shipped
 * connection that is not on its way out. `needs_reconnect` counts as
 * connected (spec default).
 *
 * Latched for the mount: Apple connects in-page and invalidates the overview,
 * so without the latch the step would vanish under the user and the step
 * index would jump. `resume` (`?resume=calendar`, the Google OAuth return)
 * re-seeds the latch after the page load — the user is connected by then —
 * and holds `settled` until the overview answers, because the resume seek
 * needs the final step list.
 */
import { useState } from 'react';
import type { CalendarsOverview } from '@raid-ledger/contract';
import { useCalendarsOverview } from '../../hooks/use-calendar-sync';
import { shippedConnections } from '../../components/features/calendar-sync/calendar-providers';

export interface CalendarStepFlag {
    needsCalendarConnect: boolean;
    /** False only while a `resume` waits for the overview. */
    settled: boolean;
}

function canConnect(overview: CalendarsOverview): boolean {
    const { google, apple } = overview.providers;
    return overview.enabled && (google.available || apple.available);
}

function hasConnection(overview: CalendarsOverview): boolean {
    return shippedConnections(overview.connections).some((c) => c.status !== 'disconnecting');
}

function wantsStep(overview: CalendarsOverview | undefined, resume: boolean): boolean {
    if (!overview || !canConnect(overview)) return false;
    return resume || !hasConnection(overview);
}

export function useCalendarStepFlag(resume: boolean): CalendarStepFlag {
    const { data, isLoading } = useCalendarsOverview();
    const wanted = wantsStep(data, resume);
    const [latched, setLatched] = useState(false);
    // Set-state-during-render (React's derived-state pattern): no extra effect pass.
    if (wanted && !latched) setLatched(true);
    return { needsCalendarConnect: wanted || latched, settled: !(resume && isLoading) };
}
