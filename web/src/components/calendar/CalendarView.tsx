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
import { getGameColors, getCalendarEventStyle } from '../../constants/game-colors';
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

/** Game info for filter sidebar */
export interface GameInfo {
    slug: string;
    name: string;
    coverUrl: string | null;
}

interface CalendarViewProps {
    className?: string;
    /** Controlled current date (optional - defaults to internal state) */
    currentDate?: Date;
    /** Callback when date changes (optional) */
    onDateChange?: (date: Date) => void;
    /** Games to filter by (optional - shows all if undefined) */
    selectedGames?: Set<string>;
    /** Callback when games list is available */
    onGamesAvailable?: (games: GameInfo[]) => void;
}

export function CalendarView({
    className = '',
    currentDate: controlledDate,
    onDateChange,
    selectedGames,
    onGamesAvailable,
}: CalendarViewProps) {
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

    // Extract unique games from events
    const uniqueGames = useMemo((): GameInfo[] => {
        if (!eventsData?.data) return [];
        const gameMap = new Map<string, GameInfo>();
        for (const event of eventsData.data) {
            if (event.game?.slug && !gameMap.has(event.game.slug)) {
                gameMap.set(event.game.slug, {
                    slug: event.game.slug,
                    name: event.game.name,
                    coverUrl: event.game.coverUrl || null,
                });
            }
        }
        return Array.from(gameMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [eventsData]);

    // Notify parent when games are available
    useMemo(() => {
        if (onGamesAvailable && uniqueGames.length > 0) {
            onGamesAvailable(uniqueGames);
        }
    }, [uniqueGames, onGamesAvailable]);

    // Transform API events to calendar events (with optional filtering)
    const calendarEvents: CalendarEvent[] = useMemo(() => {
        if (!eventsData?.data) return [];
        return eventsData.data
            .filter((event) => {
                // If no filter prop is provided (undefined), show all events
                if (selectedGames === undefined) return true;
                // If filter is set (even if empty), respect it
                // Empty Set = show nothing, populated Set = show matching
                return event.game?.slug && selectedGames.has(event.game.slug);
            })
            .map((event) => ({
                id: event.id,
                title: event.title,
                start: new Date(event.startTime),
                end: event.endTime ? new Date(event.endTime) : new Date(event.startTime),
                resource: event,
            }));
    }, [eventsData, selectedGames]);

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

    // Style events based on their game (using shared constants)
    const eventPropGetter = useCallback(
        (event: CalendarEvent) => {
            const gameSlug = event.resource?.game?.slug || 'default';
            return {
                style: getCalendarEventStyle(gameSlug),
            };
        },
        []
    );

    // Custom event component with game art background and time
    const EventComponent = useCallback(
        ({ event }: { event: CalendarEvent }) => {
            const gameSlug = event.resource?.game?.slug || 'default';
            const coverUrl = event.resource?.game?.coverUrl;
            const colors = getGameColors(gameSlug);

            // Format time compactly (e.g., "10a" or "1p")
            const timeStr = format(event.start, 'ha').toLowerCase();

            return (
                <div
                    className="calendar-event-chip"
                    title={`${event.title}${event.resource?.game?.name ? ` (${event.resource.game.name})` : ''}`}
                    style={{
                        backgroundImage: coverUrl
                            ? `linear-gradient(135deg, ${colors.bg}dd 50%, ${colors.bg}88 100%), url(${coverUrl})`
                            : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center right',
                    }}
                >
                    <span className="event-chip-time">{timeStr}</span>
                    <span className="event-chip-title">{event.title}</span>
                </div>
            );
        },
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
