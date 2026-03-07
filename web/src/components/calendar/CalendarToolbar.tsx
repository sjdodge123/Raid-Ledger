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

function NavButtons({ view, onPrev, onNext, onToday }: { view: View; onPrev: () => void; onNext: () => void; onToday: () => void }) {
    const label = view === Views.DAY ? 'day' : view === Views.WEEK ? 'week' : 'month';
    return (
        <div className="toolbar-nav">
            <button onClick={onPrev} className="toolbar-btn" aria-label={`Previous ${label}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button onClick={onToday} className="toolbar-btn today-btn">Today</button>
            <button onClick={onNext} className="toolbar-btn" aria-label={`Next ${label}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
        </div>
    );
}

function ViewSwitcher({ view, tzAbbr, onViewChange }: { view: View; tzAbbr: string; onViewChange: (v: View) => void }) {
    return (
        <div className="toolbar-views hidden md:flex" role="group" aria-label="Calendar view">
            <span className="toolbar-btn text-xs text-muted pointer-events-none" aria-label={`Times shown in ${tzAbbr}`}>{tzAbbr}</span>
            {([Views.MONTH, Views.WEEK, Views.DAY] as const).map((v) => (
                <button key={v} type="button" className={`toolbar-btn ${view === v ? 'active' : ''}`} onClick={() => onViewChange(v)} aria-pressed={view === v}>
                    {v === Views.MONTH ? 'Month' : v === Views.WEEK ? 'Week' : 'Day'}
                </button>
            ))}
        </div>
    );
}

function getToolbarTitle(view: View, currentDate: Date): string {
    if (view === Views.DAY) return format(currentDate, 'EEEE, MMMM d, yyyy');
    if (view === Views.WEEK) return formatWeekTitle(currentDate);
    return format(currentDate, 'MMMM yyyy');
}

export function CalendarToolbar({
    view, currentDate, tzAbbr, isHeaderHidden, calendarView,
    onPrev, onNext, onToday, onViewChange,
}: CalendarToolbarProps) {
    return (
        <div className={`calendar-toolbar ${calendarView ? 'calendar-toolbar-desktop-only' : 'sticky md:static'}`}
            style={{ top: isHeaderHidden ? '4.25rem' : '8.25rem', zIndex: Z_INDEX.TOOLBAR, transition: 'top 300ms ease-in-out' }}>
            <NavButtons view={view} onPrev={onPrev} onNext={onNext} onToday={onToday} />
            <h2 className="toolbar-title">{getToolbarTitle(view, currentDate)}</h2>
            <ViewSwitcher view={view} tzAbbr={tzAbbr} onViewChange={onViewChange} />
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
