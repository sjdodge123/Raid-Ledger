import { useEffect, useMemo, useState, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, Views, type View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEvents } from '../../hooks/use-events';
import { getCalendarEventStyle } from '../../constants/game-colors';
import { useTimezoneStore } from '../../stores/timezone-store';
import { useCalendarViewStore, type CalendarViewPref } from '../../stores/calendar-view-store';
import { toZonedDate, getTimezoneAbbr } from '../../lib/timezone-utils';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { TZDate } from '@date-fns/tz';
import { DayEventCard } from './DayEventCard';
import { WeekEventCard } from './WeekEventCard';
import { ScheduleView } from './ScheduleView';
import { CalendarToolbar } from './CalendarToolbar';
import { MonthEventComponent } from './MonthEventComponent';
import { VIEW_MAP, viewToStr, computeDateRange } from './calendar-view.utils';
import type { CalendarViewMode } from './calendar-mobile-toolbar';
import type { EventResponseDto } from '@raid-ledger/contract';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './calendar-styles.css';

const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

export interface CalendarEvent {
    id: number;
    title: string;
    start: Date;
    end: Date;
    resource: EventResponseDto;
}

interface CalendarViewProps {
    className?: string;
    currentDate?: Date;
    onDateChange?: (date: Date) => void;
    selectedGames?: Set<string>;
    gameTimeSlots?: Set<string>;
    calendarView?: CalendarViewMode;
    onCalendarViewChange?: (view: CalendarViewMode) => void;
}

function useCalendarDate(controlledDate?: Date, onDateChange?: (d: Date) => void) {
    const [searchParams, setSearchParams] = useSearchParams();
    const [internalDate, setInternalDate] = useState(() => {
        const dateStr = searchParams.get('date');
        if (dateStr) { const parsed = new Date(dateStr + 'T00:00:00'); if (!isNaN(parsed.getTime())) return parsed; }
        return new Date();
    });
    const currentDate = controlledDate ?? internalDate;
    const setCurrentDate = onDateChange ?? setInternalDate;

    useEffect(() => {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('date', dateStr); return next; }, { replace: true });
    }, [currentDate, setSearchParams]);

    return { currentDate, setCurrentDate, searchParams, setSearchParams };
}

function useCalendarViewSync(searchParams: URLSearchParams, setSearchParams: (fn: (p: URLSearchParams) => URLSearchParams, opts?: { replace: boolean }) => void, calendarView?: CalendarViewMode) {
    const viewPref = useCalendarViewStore((s) => s.viewPref);
    const setViewPref = useCalendarViewStore((s) => s.setViewPref);
    const urlViewParam = searchParams.get('view');
    const urlView = urlViewParam ? VIEW_MAP[urlViewParam] : undefined;
    const view: View = urlView ?? VIEW_MAP[viewPref] ?? Views.WEEK;

    const setView = useCallback((newView: View) => {
        const viewStr: CalendarViewPref = viewToStr(newView);
        setViewPref(viewStr);
        setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('view', viewStr); return next; }, { replace: true });
    }, [setViewPref, setSearchParams]);

    useEffect(() => {
        if (!calendarView || calendarView === 'schedule') return;
        const mapped = VIEW_MAP[calendarView];
        if (mapped && mapped !== view) setView(mapped);
    }, [calendarView]); // eslint-disable-line react-hooks/exhaustive-deps

    return { view, setView };
}

function useCalendarEvents(eventsData: ReturnType<typeof useEvents>['data'], selectedGames?: Set<string>, resolved?: string) {
    return useMemo(() => {
        if (!eventsData?.data) return [];
        return eventsData.data
            .filter((event) => {
                if (event.cancelledAt) return false;
                if (event.reschedulingPollId) return false;
                if (selectedGames === undefined) return true;
                return event.game?.slug && selectedGames.has(event.game.slug);
            })
            .map((event) => ({
                id: event.id, title: event.title,
                start: toZonedDate(event.startTime, resolved!),
                end: event.endTime ? toZonedDate(event.endTime, resolved!) : toZonedDate(event.startTime, resolved!),
                resource: event,
            }));
    }, [eventsData, selectedGames, resolved]);
}

function useGameTimeOverlap(gameTimeSlots?: Set<string>) {
    return useCallback((start: Date, end: Date): boolean => {
        if (!gameTimeSlots) return false;
        const cursor = new Date(start); cursor.setMinutes(0, 0, 0);
        if (cursor < start) cursor.setHours(cursor.getHours() + 1);
        while (cursor < end) {
            if (gameTimeSlots.has(`${cursor.getDay()}:${cursor.getHours()}`)) return true;
            cursor.setHours(cursor.getHours() + 1);
        }
        return false;
    }, [gameTimeSlots]);
}

function useCalendarNavigation(currentDate: Date, setCurrentDate: (d: Date) => void, view: View) {
    const handlePrev = useCallback(() => {
        if (view === Views.DAY) setCurrentDate(subDays(currentDate, 1));
        else if (view === Views.WEEK) setCurrentDate(subWeeks(currentDate, 1));
        else setCurrentDate(subMonths(currentDate, 1));
    }, [currentDate, setCurrentDate, view]);
    const handleNext = useCallback(() => {
        if (view === Views.DAY) setCurrentDate(addDays(currentDate, 1));
        else if (view === Views.WEEK) setCurrentDate(addWeeks(currentDate, 1));
        else setCurrentDate(addMonths(currentDate, 1));
    }, [currentDate, setCurrentDate, view]);
    const handleToday = useCallback(() => setCurrentDate(new Date()), [setCurrentDate]);
    return { handlePrev, handleNext, handleToday };
}

function CalendarEmptyState({ view }: { view: View }) {
    const navigate = useNavigate();
    return (
        <div className="calendar-empty">
            <div className="empty-icon">📅</div>
            <p>No events {view === Views.DAY ? 'today' : view === Views.WEEK ? 'this week' : 'this month'}</p>
            <button onClick={() => navigate('/events/new')} className="empty-cta">Create Event</button>
        </div>
    );
}

function useCalendarViewState(controlledDate: Date | undefined, onDateChange: ((d: Date) => void) | undefined, calendarView: CalendarViewMode | undefined, selectedGames: Set<string> | undefined) {
    const navigate = useNavigate();
    const resolved = useTimezoneStore((s) => s.resolved);
    const tzAbbr = useMemo(() => getTimezoneAbbr(resolved), [resolved]);
    const { currentDate, setCurrentDate, searchParams, setSearchParams } = useCalendarDate(controlledDate, onDateChange);
    const { view, setView } = useCalendarViewSync(searchParams, setSearchParams, calendarView);
    const isScheduleView = calendarView === 'schedule';
    const { startAfter, endBefore } = useMemo(() => computeDateRange(currentDate, view, isScheduleView), [currentDate, view, isScheduleView]);
    const { data: eventsData, isLoading, isFetching } = useEvents({ startAfter, endBefore, includeSignups: isScheduleView || view === Views.WEEK || view === Views.DAY, limit: 100 });
    const calendarEvents = useCalendarEvents(eventsData, selectedGames, resolved);
    const { handlePrev, handleNext, handleToday } = useCalendarNavigation(currentDate, setCurrentDate, view);
    return { navigate, resolved, tzAbbr, currentDate, setCurrentDate, view, setView, isScheduleView, isLoading, isFetching, calendarEvents, handlePrev, handleNext, handleToday };
}

function useEventWrappers(eventOverlapsGameTime: (s: Date, e: Date) => boolean, handleMonthChipClick: (e: React.MouseEvent, d: Date) => void) {
    const MonthEventWrapper = useCallback(({ event }: { event: CalendarEvent }) => <MonthEventComponent event={event} eventOverlapsGameTime={eventOverlapsGameTime} onChipClick={handleMonthChipClick} />, [eventOverlapsGameTime, handleMonthChipClick]);
    const WeekEventWrapper = useCallback(({ event }: { event: CalendarEvent }) => <WeekEventCard event={event} eventOverlapsGameTime={eventOverlapsGameTime} />, [eventOverlapsGameTime]);
    const DayEventWrapper = useCallback(({ event }: { event: CalendarEvent }) => <DayEventCard event={event} eventOverlapsGameTime={eventOverlapsGameTime} />, [eventOverlapsGameTime]);
    return { MonthEventWrapper, WeekEventWrapper, DayEventWrapper };
}

function CalendarGridBody({ s, className, isHeaderHidden, eventPropGetter, handleSelectEvent, wrappers, calendarView, onCalendarViewChange }: {
    s: ReturnType<typeof useCalendarViewState>; className: string; isHeaderHidden: boolean;
    eventPropGetter: (e: CalendarEvent) => { style: React.CSSProperties }; handleSelectEvent: (e: CalendarEvent) => void;
    wrappers: ReturnType<typeof useEventWrappers>; calendarView: CalendarViewMode | undefined; onCalendarViewChange: ((view: CalendarViewMode) => void) | undefined;
}) {
    return (
        <div className={`calendar-container calendar-view-${s.view} ${className}`}>
            <CalendarToolbar view={s.view} currentDate={s.currentDate} tzAbbr={s.tzAbbr} isHeaderHidden={isHeaderHidden} calendarView={calendarView} onPrev={s.handlePrev} onNext={s.handleNext} onToday={s.handleToday} onViewChange={s.setView} />
            {(s.isLoading || (s.isFetching && s.calendarEvents.length === 0)) && <div className="calendar-loading"><div className="loading-spinner" /><span>Loading events...</span></div>}
            <div className="calendar-grid-wrapper">
                <Calendar key={s.view} localizer={localizer} events={s.calendarEvents} date={s.currentDate} view={s.view}
                    views={[Views.MONTH, Views.WEEK, Views.DAY]} onNavigate={(date: Date) => s.setCurrentDate(date)} onView={s.setView}
                    onSelectEvent={handleSelectEvent}
                    onDrillDown={(date) => { s.setCurrentDate(date); s.setView(Views.DAY); onCalendarViewChange?.('day'); }}
                    drilldownView={Views.DAY} eventPropGetter={eventPropGetter}
                    components={{ month: { event: wrappers.MonthEventWrapper }, week: { event: wrappers.WeekEventWrapper }, day: { event: wrappers.DayEventWrapper }, toolbar: () => null }}
                    getNow={() => new TZDate(Date.now(), s.resolved)} allDayAccessor={() => false} popup selectable
                    onSelectSlot={(slotInfo) => {
                        if (slotInfo.action === 'doubleClick' || (window.innerWidth < 768 && slotInfo.action === 'click' && s.view === Views.MONTH)) {
                            s.setCurrentDate(slotInfo.start); s.setView(Views.DAY); onCalendarViewChange?.('day');
                        }
                    }}
                    style={{ minHeight: '500px' }} />
            </div>
            {!s.isLoading && !s.isFetching && s.calendarEvents.length === 0 && <CalendarEmptyState view={s.view} />}
        </div>
    );
}

function useCalendarInteractions(
    s: ReturnType<typeof useCalendarViewState>, onCalendarViewChange: ((view: CalendarViewMode) => void) | undefined,
    eventOverlapsGameTime: (start: Date, end: Date) => boolean,
) {
    const { setCurrentDate, setView, navigate, view, currentDate, isScheduleView } = s;

    const handleMonthChipClick = useCallback((e: React.MouseEvent, eventStart: Date) => {
        if (window.innerWidth >= 768) return;
        e.stopPropagation(); e.preventDefault();
        setCurrentDate(eventStart); setView(Views.DAY); onCalendarViewChange?.('day');
    }, [setCurrentDate, setView, onCalendarViewChange]);

    const handleSelectEvent = useCallback((event: CalendarEvent) => {
        if (window.innerWidth < 768 && view === Views.MONTH && !isScheduleView) {
            setCurrentDate(event.start); setView(Views.DAY); onCalendarViewChange?.('day'); return;
        }
        navigate(`/events/${event.id}`, { state: { fromCalendar: true, calendarDate: format(currentDate, 'yyyy-MM-dd'), calendarView: isScheduleView ? 'schedule' : viewToStr(view) } });
    }, [navigate, view, currentDate, isScheduleView, setCurrentDate, setView, onCalendarViewChange]);

    const eventPropGetter = useCallback((event: CalendarEvent) => ({ style: getCalendarEventStyle(event.resource?.game?.slug || 'default') }), []);
    const wrappers = useEventWrappers(eventOverlapsGameTime, handleMonthChipClick);
    return { handleSelectEvent, eventPropGetter, wrappers };
}

export function CalendarView({
    className = '', currentDate: controlledDate, onDateChange, selectedGames,
    gameTimeSlots, calendarView, onCalendarViewChange,
}: CalendarViewProps) {
    const s = useCalendarViewState(controlledDate, onDateChange, calendarView, selectedGames);
    const scrollDirection = useScrollDirection();
    const isHeaderHidden = scrollDirection === 'down';
    const eventOverlapsGameTime = useGameTimeOverlap(gameTimeSlots);
    const { handleSelectEvent, eventPropGetter, wrappers } = useCalendarInteractions(s, onCalendarViewChange, eventOverlapsGameTime);

    if (s.isScheduleView) {
        return (
            <div className={`min-w-0 ${className}`}>
                {s.isLoading && <div className="flex items-center justify-center py-16 gap-2 text-muted"><div className="loading-spinner" /><span>Loading events...</span></div>}
                {!s.isLoading && <ScheduleView events={s.calendarEvents} currentDate={s.currentDate} onDateChange={s.setCurrentDate} onSelectEvent={handleSelectEvent} eventOverlapsGameTime={eventOverlapsGameTime} isFetching={s.isFetching} />}
            </div>
        );
    }

    return <CalendarGridBody s={s} className={className} isHeaderHidden={isHeaderHidden} eventPropGetter={eventPropGetter}
        handleSelectEvent={handleSelectEvent} wrappers={wrappers} calendarView={calendarView} onCalendarViewChange={onCalendarViewChange} />;
}
