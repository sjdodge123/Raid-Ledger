import {
    startOfWeek, endOfWeek, startOfMonth, endOfMonth,
    startOfDay, endOfDay, addMonths,
} from 'date-fns';
import { Views, type View } from 'react-big-calendar';
import type { CalendarViewPref } from '../../stores/calendar-view-store';

export const VIEW_MAP: Record<string, View> = { week: Views.WEEK, day: Views.DAY, month: Views.MONTH };

export function viewToStr(view: View): CalendarViewPref {
    return view === Views.WEEK ? 'week' : view === Views.DAY ? 'day' : 'month';
}

export function computeDateRange(currentDate: Date, view: View, isScheduleView: boolean) {
    if (isScheduleView) {
        const start = startOfMonth(currentDate);
        const end = endOfMonth(addMonths(currentDate, 2));
        return { startAfter: start.toISOString(), endBefore: end.toISOString() };
    }
    if (view === Views.DAY) {
        return { startAfter: startOfDay(currentDate).toISOString(), endBefore: endOfDay(currentDate).toISOString() };
    }
    if (view === Views.WEEK) {
        const start = startOfWeek(currentDate, { weekStartsOn: 0 });
        const end = endOfWeek(currentDate, { weekStartsOn: 0 });
        return { startAfter: start.toISOString(), endBefore: end.toISOString() };
    }
    return { startAfter: startOfMonth(currentDate).toISOString(), endBefore: endOfMonth(currentDate).toISOString() };
}
