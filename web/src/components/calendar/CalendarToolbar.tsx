import { format, startOfWeek, endOfWeek } from 'date-fns';
import { Views, type View } from 'react-big-calendar';
import { Z_INDEX } from '../../lib/z-index';

interface CalendarToolbarProps {
    view: View;
    currentDate: Date;
    tzAbbr: string;
    isHeaderHidden: boolean;
    calendarView?: string;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    onViewChange: (view: View) => void;
}

export function CalendarToolbar({
    view, currentDate, tzAbbr, isHeaderHidden, calendarView,
    onPrev, onNext, onToday, onViewChange,
}: CalendarToolbarProps) {
    return (
        <div
            className={`calendar-toolbar ${calendarView ? 'calendar-toolbar-desktop-only' : 'sticky md:static'}`}
            style={{ top: isHeaderHidden ? '4.25rem' : '8.25rem', zIndex: Z_INDEX.TOOLBAR, transition: 'top 300ms ease-in-out' }}
        >
            <div className="toolbar-nav">
                <button onClick={onPrev} className="toolbar-btn" aria-label={view === Views.DAY ? 'Previous day' : view === Views.WEEK ? 'Previous week' : 'Previous month'}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <button onClick={onToday} className="toolbar-btn today-btn">Today</button>
                <button onClick={onNext} className="toolbar-btn" aria-label={view === Views.DAY ? 'Next day' : view === Views.WEEK ? 'Next week' : 'Next month'}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>
            <h2 className="toolbar-title">
                {view === Views.DAY
                    ? format(currentDate, 'EEEE, MMMM d, yyyy')
                    : view === Views.WEEK
                        ? formatWeekTitle(currentDate)
                        : format(currentDate, 'MMMM yyyy')
                }
            </h2>
            <div className="toolbar-views hidden md:flex" role="group" aria-label="Calendar view">
                <span className="toolbar-btn text-xs text-muted pointer-events-none" aria-label={`Times shown in ${tzAbbr}`}>{tzAbbr}</span>
                {([Views.MONTH, Views.WEEK, Views.DAY] as const).map((v) => (
                    <button key={v} type="button" className={`toolbar-btn ${view === v ? 'active' : ''}`} onClick={() => onViewChange(v)} aria-pressed={view === v}>
                        {v === Views.MONTH ? 'Month' : v === Views.WEEK ? 'Week' : 'Day'}
                    </button>
                ))}
            </div>
        </div>
    );
}

function formatWeekTitle(currentDate: Date): string {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    return sameMonth
        ? `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd, yyyy')}`
        : `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
}
