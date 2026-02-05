import { useMemo } from 'react';
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    isToday,
} from 'date-fns';

interface MiniCalendarProps {
    currentDate: Date;
    onDateSelect: (date: Date) => void;
    className?: string;
}

/**
 * Mini calendar navigator for sidebar (AC-5).
 * Compact month grid for quick date navigation.
 */
export function MiniCalendar({ currentDate, onDateSelect, className = '' }: MiniCalendarProps) {
    // Generate all days to display (including padding from prev/next months)
    const calendarDays = useMemo(() => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(currentDate);
        const calendarStart = startOfWeek(monthStart);
        const calendarEnd = endOfWeek(monthEnd);
        return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    }, [currentDate]);

    const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    return (
        <div className={`mini-calendar ${className}`}>
            <div className="mini-calendar-header">
                <span className="mini-calendar-title">
                    {format(currentDate, 'MMMM yyyy')}
                </span>
            </div>

            {/* Weekday headers */}
            <div className="mini-calendar-weekdays">
                {weekDays.map((day, i) => (
                    <span key={i} className="mini-weekday">
                        {day}
                    </span>
                ))}
            </div>

            {/* Day grid */}
            <div className="mini-calendar-grid">
                {calendarDays.map((day, i) => {
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isSelected = isSameDay(day, currentDate);
                    const isTodayDate = isToday(day);

                    return (
                        <button
                            key={i}
                            onClick={() => onDateSelect(day)}
                            className={`mini-day ${!isCurrentMonth ? 'other-month' : ''
                                } ${isSelected ? 'selected' : ''} ${isTodayDate ? 'today' : ''
                                }`}
                            aria-label={format(day, 'MMMM d, yyyy')}
                        >
                            {format(day, 'd')}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
