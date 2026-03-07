import { format } from 'date-fns';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { Z_INDEX } from '../../lib/z-index';
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
 * Sticky below the MobilePageToolbar, responds to scroll direction.
 * Hidden on desktop and when schedule view is active.
 */
function NavArrowButton({ onClick, label, direction }: { onClick: () => void; label: string; direction: 'prev' | 'next' }) {
    return (
        <button type="button" onClick={onClick} className="calendar-mobile-nav-arrow" aria-label={label}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={direction === 'prev' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
            </svg>
        </button>
    );
}

export function CalendarMobileNav({ currentDate, calendarView, onPrev, onNext, onToday }: CalendarMobileNavProps) {
    const scrollDirection = useScrollDirection();
    const isHeaderHidden = scrollDirection === 'down';

    if (calendarView === 'schedule') return null;

    const unit = calendarView === 'month' ? 'month' : 'day';
    const dateLabel = calendarView === 'month' ? format(currentDate, 'MMMM yyyy') : format(currentDate, 'EEE, MMM d');

    return (
        <div className="calendar-mobile-nav md:hidden" style={{ position: 'sticky', top: isHeaderHidden ? '4.25rem' : '8.25rem', zIndex: Z_INDEX.TOOLBAR, transition: 'top 300ms ease-in-out' }}>
            <NavArrowButton onClick={onPrev} label={`Previous ${unit}`} direction="prev" />
            <span className="calendar-mobile-nav-label">{dateLabel}</span>
            <NavArrowButton onClick={onNext} label={`Next ${unit}`} direction="next" />
            <button type="button" onClick={onToday} className="calendar-mobile-nav-today">Today</button>
        </div>
    );
}
