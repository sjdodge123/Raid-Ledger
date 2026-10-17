import {
    startOfWeek, endOfWeek, startOfMonth, endOfMonth,
    startOfDay, endOfDay, addMonths,
} from 'date-fns';
import { Views, type View } from 'react-big-calendar';
import type { CalendarViewPref } from '../../stores/calendar-view-store';
import type { EventResponseDto } from '@raid-ledger/contract';

export const VIEW_MAP: Record<string, View> = { week: Views.WEEK, day: Views.DAY, month: Views.MONTH };

export function viewToStr(view: View): CalendarViewPref {
    return view === Views.WEEK ? 'week' : view === Views.DAY ? 'day' : 'month';
}

/**
 * Decide whether an event should appear in the calendar grid given the current
 * game-filter selection.
 *
 * Behavior:
 * - `selectedGames === undefined` → unfiltered ("all games"); render every event.
 * - Event has no associated game (`event.game === null` or missing slug) →
 *   render unconditionally. Variety-night / gameless events are filter-agnostic
 *   because there is no game key to match against.
 * - Otherwise → render iff the event's game slug is in the selected set.
 *
 * ROK-1315: the previous predicate was `event.game?.slug && selectedGames.has(...)`
 * which dropped gameless events whenever `selectedGames` was a defined Set —
 * including the empty Set the Filter chip lands on after a user touches it.
 */
export function shouldRenderInCalendar(
    event: Pick<EventResponseDto, 'game'>,
    selectedGames: Set<string> | undefined,
): boolean {
    if (selectedGames === undefined) return true;
    if (!event.game?.slug) return true;
    return selectedGames.has(event.game.slug);
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
