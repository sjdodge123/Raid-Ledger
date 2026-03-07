import { Fragment, useMemo, useRef, useCallback, useEffect } from 'react';
import {
    format,
    startOfDay,
    isSameDay,
    startOfWeek,
    endOfWeek,
    isSameWeek,
    isSameMonth,
} from 'date-fns';
import { getGameColors } from '../../constants/game-colors';
import { useTimezoneStore } from '../../stores/timezone-store';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { AttendeeAvatars } from './AttendeeAvatars';
import type { CalendarEvent } from './CalendarView';

interface ScheduleViewProps {
    events: CalendarEvent[];
    currentDate: Date;
    onDateChange: (date: Date) => void;
    onSelectEvent: (event: CalendarEvent) => void;
    eventOverlapsGameTime: (start: Date, end: Date) => boolean;
    /** When true, a background fetch is in progress — suppresses the empty state */
    isFetching?: boolean;
}

/** Horizontal line with dot indicating current time, rendered among today's events. */
function NowLine() {
    return (
        <div className="now-line flex items-center gap-0 my-1" aria-label="Current time">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0 -ml-1" />
            <div className="flex-1 h-[2px] bg-emerald-500/50" />
        </div>
    );
}

/** Format a week range label like "Feb 15 – 21" or "Feb 28 – Mar 6". */
function formatWeekRange(date: Date): string {
    const weekStart = startOfWeek(date, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(date, { weekStartsOn: 0 });

    if (isSameMonth(weekStart, weekEnd)) {
        return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'd')}`;
    }
    return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d')}`;
}

/**
 * Rich event card for the schedule view.
 * Shows game cover, title, game name, time range, and avatar stack.
 */
function ScheduleEventCover({ coverUrl, icon }: { coverUrl?: string | null; icon: string }) {
    return (
        <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-panel">
            {coverUrl ? <img src={coverUrl} alt="" className="w-full h-full object-cover" /> : (
                <div className="w-full h-full flex items-center justify-center text-dim text-lg">{icon}</div>
            )}
        </div>
    );
}

function ScheduleEventInfo({ event, resolved }: { event: CalendarEvent; resolved: string }) {
    const formatTime = (iso: string) =>
        new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(resolved ? { timeZone: resolved } : {}) }).format(new Date(iso));
    return (
        <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{event.title}</div>
            {event.resource.game && <div className="text-xs text-muted truncate">{event.resource.game.name}</div>}
            <div className="text-xs text-emerald-400 mt-0.5">{formatTime(event.resource.startTime)} – {formatTime(event.resource.endTime)}</div>
        </div>
    );
}

function ScheduleEventCard({ event, onSelect }: { event: CalendarEvent; onSelect: (e: CalendarEvent) => void }) {
    const resolved = useTimezoneStore((s) => s.resolved);
    const colors = getGameColors(event.resource.game?.slug);
    const signups = event.resource.signupsPreview ?? [];
    const signupCount = event.resource.signupCount ?? signups.length;

    return (
        <button type="button" onClick={() => onSelect(event)}
            className="w-full flex items-center gap-3 bg-surface border border-edge rounded-lg p-3 min-h-[72px] hover:border-dim transition-colors text-left overflow-hidden"
            style={{ borderLeftWidth: '4px', borderLeftColor: colors.border }}>
            <ScheduleEventCover coverUrl={event.resource.game?.coverUrl} icon={colors.icon} />
            <ScheduleEventInfo event={event} resolved={resolved} />
            {signups.length > 0 && (
                <div className="flex-shrink-0">
                    <AttendeeAvatars signups={signups} totalCount={signupCount} size="sm" maxVisible={3} accentColor={colors.border} gameId={event.resource.game?.id} />
                </div>
            )}
        </button>
    );
}

/**
 * Mobile schedule view — continuous scrollable agenda showing only days with events.
 * Features: sticky day headers, week range separators, now-line, auto-scroll to today.
 */
function ScheduleEmpty() {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3 text-dim">
                <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            </div>
            <p className="text-muted text-sm">No events scheduled</p>
        </div>
    );
}

function DayLabel({ day, isToday, stickyTop }: { day: Date; isToday: boolean; stickyTop: string }) {
    return (
        <div className="w-11 flex-shrink-0">
            <div className="sticky z-10 bg-background pt-3 pb-2 text-center transition-[top] duration-300" style={{ top: stickyTop }}>
                <div className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? 'text-emerald-400' : 'text-muted'}`}>{format(day, 'EEE')}</div>
                <div className={isToday ? 'w-8 h-8 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center text-base font-bold' : 'text-lg font-bold text-foreground mt-0.5'}>{format(day, 'd')}</div>
            </div>
        </div>
    );
}

function DayEvents({ dayEvents, isToday, nowLineIndex, onSelectEvent }: {
    dayEvents: CalendarEvent[]; isToday: boolean; nowLineIndex: number; onSelectEvent: (e: CalendarEvent) => void;
}) {
    return (
        <div className="flex-1 min-w-0 py-2 pr-2 space-y-2">
            {isToday && dayEvents.length === 0 ? <NowLine /> : (
                dayEvents.map((event, eventIdx) => (
                    <Fragment key={event.id}>
                        {isToday && eventIdx === nowLineIndex && <NowLine />}
                        <ScheduleEventCard event={event} onSelect={onSelectEvent} />
                    </Fragment>
                ))
            )}
            {isToday && dayEvents.length > 0 && nowLineIndex === dayEvents.length && <NowLine />}
        </div>
    );
}

function useSwipeNavigation(currentDate: Date, onDateChange: (d: Date) => void) {
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const touchStartTarget = useRef<EventTarget | null>(null);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        touchStartTarget.current = e.target;
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        const dy = e.changedTouches[0].clientY - touchStartY.current;
        const startedOnButton = touchStartTarget.current instanceof HTMLElement && touchStartTarget.current.closest('button');
        const threshold = startedOnButton ? 100 : 50;
        if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
            if (startedOnButton) e.preventDefault();
            const next = new Date(currentDate);
            next.setDate(next.getDate() + (dx > 0 ? -1 : 1));
            onDateChange(next);
        }
    }, [currentDate, onDateChange]);

    return { handleTouchStart, handleTouchEnd };
}

function useScheduleData(events: CalendarEvent[]) {
    const eventsByDate = useMemo(() => {
        const map = new Map<string, CalendarEvent[]>();
        const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
        for (const event of sorted) {
            const key = format(startOfDay(event.start), 'yyyy-MM-dd');
            const group = map.get(key) || [];
            group.push(event);
            map.set(key, group);
        }
        return map;
    }, [events]);

    const daysWithEvents = useMemo(() => {
        const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');
        const keys = new Set(eventsByDate.keys());
        keys.add(todayKey);
        return [...keys].sort().map((k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); });
    }, [eventsByDate]);

    return { eventsByDate, daysWithEvents };
}

function ScheduleDayRow({ day, idx, daysWithEvents, eventsByDate, now, stickyTop, todayRef, onSelectEvent }: {
    day: Date; idx: number; daysWithEvents: Date[]; eventsByDate: Map<string, CalendarEvent[]>;
    now: Date; stickyTop: string; todayRef: React.RefObject<HTMLDivElement | null>; onSelectEvent: (e: CalendarEvent) => void;
}) {
    const key = format(day, 'yyyy-MM-dd');
    const dayEvents = eventsByDate.get(key) || [];
    const isDayToday = isSameDay(day, now);
    const prevDay = idx > 0 ? daysWithEvents[idx - 1] : null;
    const isNewWeek = !prevDay || !isSameWeek(day, prevDay, { weekStartsOn: 0 });
    let nowLineIndex = -1;
    if (isDayToday) { nowLineIndex = dayEvents.findIndex((e) => e.start > now); if (nowLineIndex === -1) nowLineIndex = dayEvents.length; }
    return (
        <Fragment key={key}>
            {isNewWeek && <div className="week-separator pl-1 pr-2 py-2 text-xs font-medium text-muted tracking-wide">{formatWeekRange(day)}</div>}
            <div ref={isDayToday ? todayRef : undefined} className={`flex gap-1.5 border-b border-edge/20 min-h-[48px] pl-1 ${isDayToday ? 'scroll-mt-36' : ''}`}>
                <DayLabel day={day} isToday={isDayToday} stickyTop={stickyTop} />
                <DayEvents dayEvents={dayEvents} isToday={isDayToday} nowLineIndex={nowLineIndex} onSelectEvent={onSelectEvent} />
            </div>
        </Fragment>
    );
}

export function ScheduleView({ events, currentDate, onDateChange, onSelectEvent, isFetching }: ScheduleViewProps) {
    const todayRef = useRef<HTMLDivElement>(null);
    const scrollDirection = useScrollDirection();
    const isHeaderHidden = scrollDirection === 'down';
    const { eventsByDate, daysWithEvents } = useScheduleData(events);
    const { handleTouchStart, handleTouchEnd } = useSwipeNavigation(currentDate, onDateChange);

    useEffect(() => {
        const timer = setTimeout(() => { todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
        return () => clearTimeout(timer);
    }, []);

    if (events.length === 0) {
        if (isFetching) return <div className="flex items-center justify-center py-16 gap-2 text-muted"><div className="loading-spinner" /><span>Loading events...</span></div>;
        return <ScheduleEmpty />;
    }

    const now = new Date();
    const stickyTop = isHeaderHidden ? '4.25rem' : '8.25rem';

    return (
        <div className="schedule-view min-w-0" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            {daysWithEvents.map((day, idx) => <ScheduleDayRow key={format(day, 'yyyy-MM-dd')} day={day} idx={idx} daysWithEvents={daysWithEvents} eventsByDate={eventsByDate} now={now} stickyTop={stickyTop} todayRef={todayRef} onSelectEvent={onSelectEvent} />)}
        </div>
    );
}
