import { useMemo } from 'react';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { useGameTime } from '../../../../hooks/use-game-time';
import type { HourRange } from '../phone/group-day.utils';

const NO_EVENTS: GameTimeEventBlock[] = [];

export interface ViewerWeekEventsOptions {
    /** Default true — Reschedule turns the desktop read off on phones. */
    enabled?: boolean;
    /** Reschedule: the event being moved already shows as "Current". */
    excludeEventId?: number;
}

/**
 * The viewer's own signed-up events in the DISPLAYED week (ROK-1588 operator
 * ruling 2026-09-17), drawn over the group views so a pick that collides with
 * something the viewer already committed to is visible before it is made.
 *
 * It is the composite game-time read (`useGameTime`) scoped with `week`. The
 * week goes out as the exact instant of local Sunday 00:00 — the server takes
 * any parseable date and fetches the seven days after it, so a date-only
 * string would be the UTC week and leak the previous Saturday evening in.
 */
export function useViewerWeekEvents(weekStart: Date, options: ViewerWeekEventsOptions = {}): GameTimeEventBlock[] {
    const { enabled = true, excludeEventId } = options;
    const { data } = useGameTime({ enabled, week: weekStart.toISOString() });
    return useMemo(() => {
        const events = data?.events ?? NO_EVENTS;
        return excludeEventId === undefined ? events : events.filter((e) => e.eventId !== excludeEventId);
    }, [data, excludeEventId]);
}

/**
 * The contiguous runs of visible-hour indexes an event covers. The visible
 * hours can wrap past midnight and skip collapsed bands, so an event is one
 * block per unbroken run rather than one `startHour → endHour` rectangle.
 */
export function eventHourRuns(
    event: Pick<GameTimeEventBlock, 'startHour' | 'endHour'>, hours: number[],
): HourRange[] {
    const runs: HourRange[] = [];
    hours.forEach((hour, index) => {
        if (hour < event.startHour || hour >= event.endHour) return;
        const last = runs[runs.length - 1];
        if (last && last.endIndex === index && hours[index - 1] === hour - 1) last.endIndex = index + 1;
        else runs.push({ startIndex: index, endIndex: index + 1 });
    });
    return runs;
}
