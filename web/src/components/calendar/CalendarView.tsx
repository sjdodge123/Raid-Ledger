import { useMemo, useState, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, Views, type View } from 'react-big-calendar';
import {
    format,
    parse,
    startOfWeek,
    getDay,
    startOfMonth,
    endOfMonth,
    addMonths,
    subMonths,
} from 'date-fns';
import { enUS } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { useEvents } from '../../hooks/use-events';
import type { EventResponseDto } from '@raid-ledger/contract';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './calendar-styles.css';

// Setup date-fns localizer for react-big-calendar
const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
});

interface CalendarEvent {
    id: number;
    title: string;
    start: Date;
    end: Date;
    resource: EventResponseDto;
}

interface CalendarViewProps {
    className?: string;
    /** Controlled current date (optional - defaults to internal state) */
    currentDate?: Date;
    /** Callback when date changes (optional) */
    onDateChange?: (date: Date) => void;
}

export function CalendarView({ className = '', currentDate: controlledDate, onDateChange }: CalendarViewProps) {
    const navigate = useNavigate();
    const [internalDate, setInternalDate] = useState(new Date());

    // Use controlled date if provided, otherwise internal state
    const currentDate = controlledDate ?? internalDate;
    const setCurrentDate = onDateChange ?? setInternalDate;

    const [view, setView] = useState<View>(Views.MONTH);

    // Calculate date range for current view
    const { startAfter, endBefore } = useMemo(() => {
        const start = startOfMonth(currentDate);
        const end = endOfMonth(currentDate);
        return {
            startAfter: start.toISOString(),
            endBefore: end.toISOString(),
        };
    }, [currentDate]);

    // Fetch events for the current month
    const { data: eventsData, isLoading } = useEvents({
        startAfter,
        endBefore,
        upcoming: false, // Get all events in range, not just upcoming
    });

    // Transform API events to calendar events
    const calendarEvents: CalendarEvent[] = useMemo(() => {
        if (!eventsData?.data) return [];
        return eventsData.data.map((event) => ({
            id: event.id,
            title: event.title,
            start: new Date(event.startTime),
            end: event.endTime ? new Date(event.endTime) : new Date(event.startTime),
            resource: event,
        }));
    }, [eventsData]);

    // Navigation handlers
    const handleNavigate = useCallback((date: Date) => {
        setCurrentDate(date);
    }, [setCurrentDate]);

    const handlePrevMonth = useCallback(() => {
        setCurrentDate(subMonths(currentDate, 1));
    }, [currentDate, setCurrentDate]);

    const handleNextMonth = useCallback(() => {
        setCurrentDate(addMonths(currentDate, 1));
    }, [currentDate, setCurrentDate]);

    const handleToday = useCallback(() => {
        setCurrentDate(new Date());
    }, [setCurrentDate]);

    // Event click handler
    const handleSelectEvent = useCallback(
        (event: CalendarEvent) => {
            navigate(`/events/${event.id}`);
        },
        [navigate]
    );

    // Game color mapping - distinct colors for each game
    const GAME_COLORS: Record<string, { bg: string; border: string; text: string }> = {
        wow: { bg: 'rgba(139, 92, 246, 0.8)', border: '#8b5cf6', text: '#fff' },      // Purple (WoW)
        ffxiv: { bg: 'rgba(59, 130, 246, 0.8)', border: '#3b82f6', text: '#fff' },    // Blue (FFXIV)
        valheim: { bg: 'rgba(34, 197, 94, 0.8)', border: '#22c55e', text: '#fff' },   // Green (Valheim)
        generic: { bg: 'rgba(156, 163, 175, 0.8)', border: '#9ca3af', text: '#fff' }, // Gray (Generic)
        default: { bg: 'rgba(236, 72, 153, 0.8)', border: '#ec4899', text: '#fff' },  // Pink (Fallback)
    };

    // Style events based on their game
    const eventPropGetter = useCallback(
        (event: CalendarEvent) => {
            const gameSlug = event.resource?.game?.slug || 'default';
            const colors = GAME_COLORS[gameSlug] || GAME_COLORS.default;

            return {
                style: {
                    backgroundColor: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    color: colors.text,
                    padding: '2px 6px',
                    fontSize: '0.75rem',
                    fontWeight: '500',
                    cursor: 'pointer',
                },
            };
        },
        []
    );

    // Custom event component for chips
    const EventComponent = useCallback(
        ({ event }: { event: CalendarEvent }) => (
            <div className="calendar-event-chip" title={event.title}>
                <span className="event-chip-title">{event.title}</span>
            </div>
        ),
        []
    );

    return (
        <div className={`calendar-container ${className}`}>
            {/* Custom Toolbar */}
            <div className="calendar-toolbar">
                <div className="toolbar-nav">
                    <button
                        onClick={handlePrevMonth}
                        className="toolbar-btn"
                        aria-label="Previous month"
                    >
                        <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 19l-7-7 7-7"
                            />
                        </svg>
                    </button>
                    <button onClick={handleToday} className="toolbar-btn today-btn">
                        Today
                    </button>
                    <button
                        onClick={handleNextMonth}
                        className="toolbar-btn"
                        aria-label="Next month"
                    >
                        <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                            />
                        </svg>
                    </button>
                </div>
                <h2 className="toolbar-title">{format(currentDate, 'MMMM yyyy')}</h2>
                <div className="toolbar-views">
                    <button
                        className={`toolbar-btn ${view === Views.MONTH ? 'active' : ''}`}
                        onClick={() => setView(Views.MONTH)}
                    >
                        Month
                    </button>
                    <button
                        className="toolbar-btn disabled"
                        disabled
                        title="Week view coming soon (ROK-172)"
                    >
                        Week
                    </button>
                </div>
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="calendar-loading">
                    <div className="loading-spinner" />
                    <span>Loading events...</span>
                </div>
            )}

            {/* Calendar Grid */}
            <div className="calendar-grid-wrapper">
                <Calendar
                    localizer={localizer}
                    events={calendarEvents}
                    date={currentDate}
                    view={view}
                    views={[Views.MONTH]}
                    onNavigate={handleNavigate}
                    onView={setView}
                    onSelectEvent={handleSelectEvent}
                    eventPropGetter={eventPropGetter}
                    components={{
                        event: EventComponent,
                        toolbar: () => null, // Hide default toolbar
                    }}
                    popup
                    selectable={false}
                    style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}
                />
            </div>

            {/* Empty State */}
            {!isLoading && calendarEvents.length === 0 && (
                <div className="calendar-empty">
                    <div className="empty-icon">📅</div>
                    <p>No events this month</p>
                    <button
                        onClick={() => navigate('/events/new')}
                        className="empty-cta"
                    >
                        Create Event
                    </button>
                </div>
            )}
        </div>
    );
}
