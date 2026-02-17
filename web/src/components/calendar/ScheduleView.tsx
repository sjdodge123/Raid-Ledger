import { useMemo, useRef, useCallback } from 'react';
import { format, startOfDay, isSameDay } from 'date-fns';
import { getGameColors } from '../../constants/game-colors';
import type { CalendarEvent } from './CalendarView';

interface ScheduleViewProps {
    events: CalendarEvent[];
    currentDate: Date;
    onDateChange: (date: Date) => void;
    onSelectEvent: (event: CalendarEvent) => void;
    eventOverlapsGameTime: (start: Date, end: Date) => boolean;
}

interface DayGroup {
    date: Date;
    label: string;
    events: CalendarEvent[];
}

/**
 * Mobile schedule view — Google Calendar-style agenda grouped by day.
 * Day headers on the left, colored event blocks on the right.
 */
export function ScheduleView({
    events,
    currentDate,
    onDateChange,
    onSelectEvent,
}: ScheduleViewProps) {
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);

    // Group events by day, sorted ascending
    const dayGroups = useMemo((): DayGroup[] => {
        if (events.length === 0) return [];

        const groupMap = new Map<string, CalendarEvent[]>();

        // Sort events by start time
        const sorted = [...events].sort(
            (a, b) => a.start.getTime() - b.start.getTime(),
        );

        for (const event of sorted) {
            const key = format(startOfDay(event.start), 'yyyy-MM-dd');
            const group = groupMap.get(key);
            if (group) {
                group.push(event);
            } else {
                groupMap.set(key, [event]);
            }
        }

        return Array.from(groupMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, groupEvents]) => {
                const date = startOfDay(groupEvents[0].start);
                const isToday = isSameDay(date, new Date());
                const label = isToday
                    ? `Today - ${format(date, 'EEEE, MMM d')}`
                    : format(date, 'EEEE, MMM d');
                return { date, label, events: groupEvents };
            });
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
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </div>
                <p className="text-muted text-sm">No events this week</p>
            </div>
        );
    }

    return (
        <div
            className="schedule-view"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {dayGroups.map((group) => {
                const isToday = isSameDay(group.date, new Date());
                return (
                    <div key={group.label} className="flex gap-4 py-4 border-b border-edge/30 last:border-b-0">
                        {/* Day label column — fixed width left side */}
                        <div className="w-14 flex-shrink-0 text-center pt-1">
                            <div className={`text-xs font-semibold uppercase tracking-wider ${isToday ? 'text-emerald-400' : 'text-muted'}`}>
                                {format(group.date, 'EEE')}
                            </div>
                            <div className={`text-2xl font-bold mt-0.5 ${isToday ? 'w-10 h-10 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center' : 'text-foreground'}`}>
                                {format(group.date, 'd')}
                            </div>
                        </div>

                        {/* Events column */}
                        <div className="flex-1 min-w-0 space-y-2">
                            {group.events.map((event) => {
                                const gameSlug = event.resource.game?.slug;
                                const colors = getGameColors(gameSlug);
                                return (
                                    <button
                                        key={event.id}
                                        type="button"
                                        onClick={() => onSelectEvent(event)}
                                        className="w-full text-left rounded-lg px-4 py-3 transition-opacity hover:opacity-80"
                                        style={{ backgroundColor: colors.bg, borderLeft: `4px solid ${colors.border}` }}
                                    >
                                        <div className="font-semibold text-sm" style={{ color: colors.text }}>
                                            {event.title}
                                        </div>
                                        <div className="text-xs mt-0.5 opacity-80" style={{ color: colors.text }}>
                                            {format(event.start, 'h:mm a')} - {format(event.end, 'h:mm a')}
                                            {event.resource.game && ` · ${event.resource.game.name}`}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
