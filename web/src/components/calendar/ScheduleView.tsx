import { useMemo, useRef, useCallback } from 'react';
import { format, startOfDay, isSameDay } from 'date-fns';
import { MobileEventCard } from '../events/mobile-event-card';
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
 * Mobile schedule view — vertical agenda list grouped by day.
 * Uses MobileEventCard for each event entry.
 */
export function ScheduleView({
    events,
    currentDate,
    onDateChange,
    onSelectEvent,
    eventOverlapsGameTime,
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
            className="schedule-view space-y-4"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {dayGroups.map((group) => (
                <div key={group.label} className="schedule-day-group">
                    {/* Sticky day header */}
                    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 px-1">
                        <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">
                            {group.label}
                        </h3>
                    </div>

                    {/* Event cards for this day */}
                    <div className="space-y-2 px-1">
                        {group.events.map((event) => (
                            <MobileEventCard
                                key={event.id}
                                event={event.resource}
                                signupCount={event.resource.signupsPreview?.length ?? 0}
                                onClick={() => onSelectEvent(event)}
                                matchesGameTime={eventOverlapsGameTime(event.start, event.end)}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
