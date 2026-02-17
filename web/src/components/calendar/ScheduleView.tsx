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
function ScheduleEventCard({
    event,
    onSelect,
}: {
    event: CalendarEvent;
    onSelect: (e: CalendarEvent) => void;
}) {
    const resolved = useTimezoneStore((s) => s.resolved);
    const colors = getGameColors(event.resource.game?.slug);
    const coverUrl = event.resource.game?.coverUrl;
    const signups = event.resource.signupsPreview ?? [];
    const signupCount = event.resource.signupCount ?? signups.length;

    const formatTime = (iso: string) =>
        new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            ...(resolved ? { timeZone: resolved } : {}),
        }).format(new Date(iso));

    return (
        <button
            type="button"
            onClick={() => onSelect(event)}
            className="w-full flex items-center gap-3 bg-surface border border-edge rounded-lg p-3 min-h-[72px] hover:border-dim transition-colors text-left overflow-hidden"
            style={{ borderLeftWidth: '4px', borderLeftColor: colors.border }}
        >
            {/* Game cover */}
            <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-panel">
                {coverUrl ? (
                    <img
                        src={coverUrl}
                        alt=""
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-dim text-lg">
                        {colors.icon}
                    </div>
                )}
            </div>

            {/* Event info */}
            <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">
                    {event.title}
                </div>
                {event.resource.game && (
                    <div className="text-xs text-muted truncate">
                        {event.resource.game.name}
                    </div>
                )}
                <div className="text-xs text-emerald-400 mt-0.5">
                    {formatTime(event.resource.startTime)} –{' '}
                    {formatTime(event.resource.endTime)}
                </div>
            </div>

            {/* Avatar stack */}
            {signups.length > 0 && (
                <div className="flex-shrink-0">
                    <AttendeeAvatars
                        signups={signups}
                        totalCount={signupCount}
                        size="sm"
                        maxVisible={3}
                        accentColor={colors.border}
                        gameId={event.resource.game?.id?.toString()}
                    />
                </div>
            )}
        </button>
    );
}

/**
 * Mobile schedule view — continuous scrollable agenda showing only days with events.
 * Features: sticky day headers, week range separators, now-line, auto-scroll to today.
 */
export function ScheduleView({
    events,
    currentDate,
    onDateChange,
    onSelectEvent,
}: ScheduleViewProps) {
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const todayRef = useRef<HTMLDivElement>(null);

    // Scroll direction for sticky header offset (matches CalendarView toolbar pattern)
    const scrollDirection = useScrollDirection();
    const isHeaderHidden = scrollDirection === 'down';

    // Build event lookup by date
    const eventsByDate = useMemo(() => {
        const map = new Map<string, CalendarEvent[]>();
        const sorted = [...events].sort(
            (a, b) => a.start.getTime() - b.start.getTime(),
        );
        for (const event of sorted) {
            const key = format(startOfDay(event.start), 'yyyy-MM-dd');
            const group = map.get(key) || [];
            group.push(event);
            map.set(key, group);
        }
        return map;
    }, [events]);

    // Only show days that have events, always include today
    const daysWithEvents = useMemo(() => {
        const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');
        const keys = new Set(eventsByDate.keys());
        keys.add(todayKey);

        const sorted = [...keys].sort();
        return sorted.map((k) => {
            const [y, m, d] = k.split('-').map(Number);
            return new Date(y, m - 1, d);
        });
    }, [eventsByDate]);

    // Horizontal swipe to change day
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
    }, []);

    const handleTouchEnd = useCallback(
        (e: React.TouchEvent) => {
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            const dy = e.changedTouches[0].clientY - touchStartY.current;

            // Only trigger if horizontal movement dominates vertical
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                const offset = dx > 0 ? -1 : 1; // swipe right = prev, swipe left = next
                const next = new Date(currentDate);
                next.setDate(next.getDate() + offset);
                onDateChange(next);
            }
        },
        [currentDate, onDateChange],
    );

    // Auto-scroll to today on mount
    useEffect(() => {
        const timer = setTimeout(() => {
            todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        return () => clearTimeout(timer);
    }, []);

    if (events.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="text-4xl mb-3 text-dim">
                    <svg
                        className="w-12 h-12 mx-auto"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                    </svg>
                </div>
                <p className="text-muted text-sm">No events scheduled</p>
            </div>
        );
    }

    const now = new Date();
    const stickyTop = isHeaderHidden ? '4.25rem' : '8.25rem';

    return (
        <div
            className="schedule-view min-w-0"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {daysWithEvents.map((day, idx) => {
                const key = format(day, 'yyyy-MM-dd');
                const dayEvents = eventsByDate.get(key) || [];
                const isToday = isSameDay(day, now);
                const prevDay = idx > 0 ? daysWithEvents[idx - 1] : null;
                const isNewWeek = !prevDay || !isSameWeek(day, prevDay, { weekStartsOn: 0 });

                // Compute now-line position for today
                let nowLineIndex = -1;
                if (isToday) {
                    nowLineIndex = dayEvents.findIndex((e) => e.end > now);
                    if (nowLineIndex === -1) nowLineIndex = dayEvents.length;
                }

                return (
                    <Fragment key={key}>
                        {/* Week range separator */}
                        {isNewWeek && (
                            <div className="week-separator pl-1 pr-2 py-2 text-xs font-medium text-muted tracking-wide">
                                {formatWeekRange(day)}
                            </div>
                        )}

                        <div
                            ref={isToday ? todayRef : undefined}
                            className={`flex gap-1.5 border-b border-edge/20 min-h-[48px] pl-1 ${isToday ? 'scroll-mt-36' : ''}`}
                        >
                            {/* Day label column — stretches to full row height so inner sticky works */}
                            <div className="w-11 flex-shrink-0">
                                <div
                                    className="sticky z-10 bg-background pt-3 pb-2 text-center transition-[top] duration-300"
                                    style={{ top: stickyTop }}
                                >
                                    <div
                                        className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? 'text-emerald-400' : 'text-muted'}`}
                                    >
                                        {format(day, 'EEE')}
                                    </div>
                                    <div
                                        className={
                                            isToday
                                                ? 'w-8 h-8 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center text-base font-bold'
                                                : 'text-lg font-bold text-foreground mt-0.5'
                                        }
                                    >
                                        {format(day, 'd')}
                                    </div>
                                </div>
                            </div>

                            {/* Events column */}
                            <div className="flex-1 min-w-0 py-2 pr-2 space-y-2">
                                {isToday && dayEvents.length === 0 ? (
                                    <NowLine />
                                ) : (
                                    dayEvents.map((event, eventIdx) => (
                                        <Fragment key={event.id}>
                                            {isToday && eventIdx === nowLineIndex && (
                                                <NowLine />
                                            )}
                                            <ScheduleEventCard
                                                event={event}
                                                onSelect={onSelectEvent}
                                            />
                                        </Fragment>
                                    ))
                                )}
                                {/* Now line after all events if all are past */}
                                {isToday && dayEvents.length > 0 && nowLineIndex === dayEvents.length && (
                                    <NowLine />
                                )}
                            </div>
                        </div>
                    </Fragment>
                );
            })}
        </div>
    );
}
