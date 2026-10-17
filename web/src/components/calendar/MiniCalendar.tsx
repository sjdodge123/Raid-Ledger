import { useMemo, useState } from 'react';
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
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function MiniCalendarHeader({ displayedMonth, onPrev, onNext }: { displayedMonth: Date; onPrev: () => void; onNext: () => void }) {
    return (
        <div className="mini-calendar-header">
            <button onClick={onPrev} className="mini-nav-btn" aria-label="Previous month" type="button">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span className="mini-calendar-title">{format(displayedMonth, 'MMMM yyyy')}</span>
            <button onClick={onNext} className="mini-nav-btn" aria-label="Next month" type="button">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
            </button>
        </div>
    );
}

function DayButton({ day, displayedMonth, currentDate, onDateSelect }: {
    day: Date; displayedMonth: Date; currentDate: Date; onDateSelect: (d: Date) => void;
}) {
    const isCurrentMonth = isSameMonth(day, displayedMonth);
    const isSelected = isSameDay(day, currentDate);
    const isTodayDate = isToday(day);
    return (
        <button type="button" onClick={() => onDateSelect(day)}
            className={`mini-day ${!isCurrentMonth ? 'other-month' : ''} ${isSelected ? 'selected' : ''} ${isTodayDate ? 'today' : ''}`}
            aria-label={format(day, 'MMMM d, yyyy')}>{format(day, 'd')}</button>
    );
}

export function MiniCalendar({ currentDate, onDateSelect, className = '' }: MiniCalendarProps) {
    const [monthOffset, setMonthOffset] = useState(0);

    const displayedMonth = useMemo(() => {
        const baseMonth = startOfMonth(currentDate);
        if (monthOffset === 0) return baseMonth;
        return monthOffset > 0 ? addMonths(baseMonth, monthOffset) : subMonths(baseMonth, Math.abs(monthOffset));
    }, [currentDate, monthOffset]);

    const calendarDays = useMemo(() => {
        const monthStart = startOfMonth(displayedMonth);
        return eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(endOfMonth(displayedMonth)) });
    }, [displayedMonth]);

    return (
        <div className={`mini-calendar ${className}`}>
            <MiniCalendarHeader displayedMonth={displayedMonth} onPrev={() => setMonthOffset((p) => p - 1)} onNext={() => setMonthOffset((p) => p + 1)} />
            <div className="mini-calendar-weekdays">
                {WEEKDAYS.map((day, i) => <span key={i} className="mini-weekday">{day}</span>)}
            </div>
            <div className="mini-calendar-grid">
                {calendarDays.map((day, i) => (
                    <DayButton key={i} day={day} displayedMonth={displayedMonth} currentDate={currentDate} onDateSelect={onDateSelect} />
                ))}
            </div>
        </div>
    );
}
