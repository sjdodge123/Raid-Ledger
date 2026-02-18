import { format } from 'date-fns';
import type { CalendarViewMode } from './calendar-mobile-toolbar';

interface CalendarMobileNavProps {
    currentDate: Date;
    calendarView: CalendarViewMode;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
}

/**
 * Compact inline date navigation bar for mobile month/day views (ROK-368).
 * Hidden on desktop and when schedule view is active.
 */
export function CalendarMobileNav({ currentDate, calendarView, onPrev, onNext, onToday }: CalendarMobileNavProps) {
    // Only show for month and day views — schedule uses swipe gestures
    if (calendarView === 'schedule') return null;

    const dateLabel = calendarView === 'month'
        ? format(currentDate, 'MMMM yyyy')
        : format(currentDate, 'EEE, MMM d');

    return (
        <div className="calendar-mobile-nav md:hidden">
            <button
                type="button"
                onClick={onPrev}
                className="calendar-mobile-nav-arrow"
                aria-label={calendarView === 'month' ? 'Previous month' : 'Previous day'}
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
            </button>

            <span className="calendar-mobile-nav-label">{dateLabel}</span>

            <button
                type="button"
                onClick={onToday}
                className="calendar-mobile-nav-today"
            >
                Today
            </button>

            <button
                type="button"
                onClick={onNext}
                className="calendar-mobile-nav-arrow"
                aria-label={calendarView === 'month' ? 'Next month' : 'Next day'}
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>
    );
}
