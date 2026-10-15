/**
 * ROK-1774/1775 — layer query range: the visible days' wall-clock bounds anchored
 * in the SELECTED timezone, not the browser's, so items near a day boundary are
 * not dropped. Month covers the whole 6-row grid (incl. off-range days); Schedule
 * covers the same three months its events query does (`computeDateRange`).
 */
import { useMemo } from 'react';
import { Views, type View } from 'react-big-calendar';
import { addMonths, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';
import { TZDate } from '@date-fns/tz';

function visibleDays(currentDate: Date, view: View, isScheduleView: boolean): [Date, Date] {
    if (isScheduleView) return [startOfMonth(currentDate), endOfMonth(addMonths(currentDate, 2))];
    if (view === Views.DAY) return [currentDate, currentDate];
    if (view === Views.WEEK) return [startOfWeek(currentDate), endOfWeek(currentDate)];
    return [startOfWeek(startOfMonth(currentDate)), endOfWeek(endOfMonth(currentDate))];
}

export function useZonedLayerRange(currentDate: Date, view: View, isScheduleView: boolean, tz: string): { from: string; to: string } {
    return useMemo(() => {
        const [first, last] = visibleDays(currentDate, view, isScheduleView);
        const from = TZDate.tz(tz, first.getFullYear(), first.getMonth(), first.getDate());
        const to = TZDate.tz(tz, last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999);
        return { from: new Date(from.getTime()).toISOString(), to: new Date(to.getTime()).toISOString() };
    }, [currentDate, view, isScheduleView, tz]);
}
