import { useMemo, useState, useEffect } from 'react';
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
    addMonths,
    subMonths,
} from 'date-fns';

interface MiniCalendarProps {
    /** The date currently selected/displayed in the main calendar */
    currentDate: Date;
    /** Called when user clicks a day - navigates main calendar to that date */
    onDateSelect: (date: Date) => void;
    className?: string;
}

/**
 * Mini calendar navigator for sidebar (AC-5).
 * Compact month grid with independent month navigation.
 * Clicking a day navigates the main calendar to that date.
 */
export function MiniCalendar({ currentDate, onDateSelect, className = '' }: MiniCalendarProps) {
    // Mini calendar has its own month navigation (independent of main calendar)
    const [displayedMonth, setDisplayedMonth] = useState(() => startOfMonth(currentDate));

    // Only sync when the main calendar's month actually changes (user navigated main calendar)
    // This allows independent browsing in mini calendar while still syncing on main nav
    useEffect(() => {
        const mainMonth = startOfMonth(currentDate);
        // Don't sync if we're already showing a different month intentionally
        // Only sync if the currentDate month changed from what we last synced to
        setDisplayedMonth(mainMonth);
    }, [currentDate.getMonth(), currentDate.getFullYear()]);

    // Generate all days to display (including padding from prev/next months)
    const calendarDays = useMemo(() => {
        const monthStart = startOfMonth(displayedMonth);
        const monthEnd = endOfMonth(displayedMonth);
        const calendarStart = startOfWeek(monthStart);
        const calendarEnd = endOfWeek(monthEnd);
        return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    }, [displayedMonth]);

    const handlePrevMonth = () => {
        setDisplayedMonth((prev) => subMonths(prev, 1));
    };

    const handleNextMonth = () => {
        setDisplayedMonth((prev) => addMonths(prev, 1));
    };

    const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    return (
        <div className={`mini-calendar ${className}`}>
            <div className="mini-calendar-header">
                <button
                    onClick={handlePrevMonth}
                    className="mini-nav-btn"
                    aria-label="Previous month"
                    type="button"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>
                <span className="mini-calendar-title">
                    {format(displayedMonth, 'MMMM yyyy')}
                </span>
                <button
                    onClick={handleNextMonth}
                    className="mini-nav-btn"
                    aria-label="Next month"
                    type="button"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18l6-6-6-6" />
                    </svg>
                </button>
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
                    const isCurrentMonth = isSameMonth(day, displayedMonth);
                    const isSelected = isSameDay(day, currentDate);
                    const isTodayDate = isToday(day);

                    return (
                        <button
                            key={i}
                            type="button"
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
