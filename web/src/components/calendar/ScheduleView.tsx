import { useMemo, useRef, useCallback } from 'react';
import {
    format,
    startOfDay,
    startOfMonth,
    endOfMonth,
    addDays,
    addMonths,
    isSameDay,
} from 'date-fns';
import { getGameColors } from '../../constants/game-colors';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import { useTimezoneStore } from '../../stores/timezone-store';
import type { CalendarEvent } from './CalendarView';

interface ScheduleViewProps {
    events: CalendarEvent[];
    currentDate: Date;
    onDateChange: (date: Date) => void;
    onSelectEvent: (event: CalendarEvent) => void;
    eventOverlapsGameTime: (start: Date, end: Date) => boolean;
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
    const avatars = signups.slice(0, 3).map((s) => resolveAvatar(toAvatarUser(s)));
    const totalSignups = signups.length;

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
            className="w-full flex items-center gap-3 bg-surface border border-edge rounded-lg p-3 min-h-[72px] hover:border-dim transition-colors text-left"
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
            {totalSignups > 0 && (
                <div className="flex items-center gap-1 flex-shrink-0">
                    <div className="flex -space-x-1.5">
                        {avatars.map((avatar, i) => (
                            <div
                                key={i}
                                className="w-5 h-5 rounded-full border border-surface bg-overlay overflow-hidden"
                            >
                                {avatar.url ? (
                                    <img
                                        src={avatar.url}
                                        alt=""
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[8px] text-muted font-medium">
                                        ?
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    {totalSignups > 3 && (
                        <span className="text-[10px] text-emerald-400 font-medium">
                            +{totalSignups - 3}
                        </span>
                    )}
                </div>
            )}
        </button>
    );
}

/**
 * Mobile schedule view — continuous scrollable agenda with all days visible.
 * Sticky day headers on the left, rich event cards on the right.
 */
export function ScheduleView({
    events,
    currentDate,
    onDateChange,
    onSelectEvent,
}: ScheduleViewProps) {
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);

    // Generate all days from start of current month to end of month+2
    const allDays = useMemo(() => {
        const start = startOfMonth(currentDate);
        const end = endOfMonth(addMonths(currentDate, 2));
        const days: Date[] = [];
        let day = start;
        while (day <= end) {
            days.push(day);
            day = addDays(day, 1);
        }
        return days;
    }, [currentDate]);

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

    return (
        <div
            className="schedule-view"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {allDays.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const dayEvents = eventsByDate.get(key) || [];
                const isToday = isSameDay(day, new Date());

                return (
                    <div
                        key={key}
                        className="flex gap-3 border-b border-edge/20 min-h-[48px]"
                    >
                        {/* Sticky day label column */}
                        <div className="w-14 flex-shrink-0 sticky top-0 z-10 bg-background pt-3 pb-2 text-center self-start">
                            <div
                                className={`text-[10px] font-semibold uppercase tracking-wider ${isToday ? 'text-emerald-400' : 'text-muted'}`}
                            >
                                {format(day, 'EEE')}
                            </div>
                            <div
                                className={
                                    isToday
                                        ? 'w-9 h-9 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center text-lg font-bold'
                                        : 'text-xl font-bold text-foreground mt-0.5'
                                }
                            >
                                {format(day, 'd')}
                            </div>
                        </div>

                        {/* Events column */}
                        <div className="flex-1 min-w-0 py-2 space-y-2">
                            {dayEvents.length === 0 ? (
                                <div className="py-2 text-xs text-dim">
                                    No events
                                </div>
                            ) : (
                                dayEvents.map((event) => (
                                    <ScheduleEventCard
                                        key={event.id}
                                        event={event}
                                        onSelect={onSelectEvent}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
