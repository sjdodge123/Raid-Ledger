import { useMemo, useState, useCallback, useEffect } from 'react';
import { Calendar, dateFnsLocalizer, Views, type View } from 'react-big-calendar';
import {
    format,
    parse,
    startOfWeek,
    endOfWeek,
    getDay,
    startOfMonth,
    endOfMonth,
    startOfDay,
    endOfDay,
    addMonths,
    subMonths,
    addWeeks,
    subWeeks,
    addDays,
    subDays,
} from 'date-fns';
import { enUS } from 'date-fns/locale';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEvents } from '../../hooks/use-events';
import { getGameColors, getCalendarEventStyle } from '../../constants/game-colors';
import { useTimezoneStore } from '../../stores/timezone-store';
import { toZonedDate, getTimezoneAbbr } from '../../lib/timezone-utils';
import { TZDate } from '@date-fns/tz';
import { DayEventCard } from './DayEventCard';
import { WeekEventCard } from './WeekEventCard';
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

export interface CalendarEvent {
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
    /** Game time template slots for overlap indicator (Set of "dayOfWeek:hour") */
    gameTimeSlots?: Set<string>;
}

export function CalendarView({
    className = '',
    currentDate: controlledDate,
    onDateChange,
    selectedGames,
    onGamesAvailable,
    gameTimeSlots,
}: CalendarViewProps) {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const resolved = useTimezoneStore((s) => s.resolved);
    const tzAbbr = useMemo(() => getTimezoneAbbr(resolved), [resolved]);
    const [internalDate, setInternalDate] = useState(() => {
        const dateStr = searchParams.get('date');
        if (dateStr) {
            const parsed = new Date(dateStr + 'T00:00:00');
            if (!isNaN(parsed.getTime())) return parsed;
        }
        return new Date();
    });

    // Use controlled date if provided, otherwise internal state
    const currentDate = controlledDate ?? internalDate;
    const setCurrentDate = onDateChange ?? setInternalDate;

    // View state with URL sync and localStorage persistence
    const getInitialView = (): View => {
        const urlView = searchParams.get('view');
        if (urlView === 'week') return Views.WEEK;
        if (urlView === 'day') return Views.DAY;
        if (urlView === 'month') return Views.MONTH;
        // Fallback to localStorage
        const stored = localStorage.getItem('calendar-view');
        if (stored === 'week') return Views.WEEK;
        if (stored === 'day') return Views.DAY;
        return Views.MONTH;
    };

    const [view, setViewState] = useState<View>(getInitialView);

    // Sync view changes to URL and localStorage
    const setView = useCallback((newView: View) => {
        setViewState(newView);
        const viewStr = newView === Views.WEEK ? 'week' : newView === Views.DAY ? 'day' : 'month';
        localStorage.setItem('calendar-view', viewStr);
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('view', viewStr);
            return next;
        }, { replace: true });
    }, [setSearchParams]);

    // Sync date changes to URL (same replace pattern as view)
    useEffect(() => {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('date', dateStr);
            return next;
        }, { replace: true });
    }, [currentDate, setSearchParams]);

    // Calculate date range for current view (month, week, or day)
    const { startAfter, endBefore } = useMemo(() => {
        if (view === Views.DAY) {
            const start = startOfDay(currentDate);
            const end = endOfDay(currentDate);
            return {
                startAfter: start.toISOString(),
                endBefore: end.toISOString(),
            };
        }
        if (view === Views.WEEK) {
            const start = startOfWeek(currentDate, { weekStartsOn: 0 });
            const end = endOfWeek(currentDate, { weekStartsOn: 0 });
            return {
                startAfter: start.toISOString(),
                endBefore: end.toISOString(),
            };
        }
        // Month view
        const start = startOfMonth(currentDate);
        const end = endOfMonth(currentDate);
        return {
            startAfter: start.toISOString(),
            endBefore: end.toISOString(),
        };
    }, [currentDate, view]);

    // Fetch events for the current month
    // ROK-177: Include signups preview for week/day views to show attendee avatars
    const { data: eventsData, isLoading } = useEvents({
        startAfter,
        endBefore,
        upcoming: false, // Get all events in range, not just upcoming
        includeSignups: view === Views.WEEK || view === Views.DAY,
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

    // Notify parent when games change (including when empty)
    useEffect(() => {
        if (onGamesAvailable) {
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
                start: toZonedDate(event.startTime, resolved),
                end: event.endTime ? toZonedDate(event.endTime, resolved) : toZonedDate(event.startTime, resolved),
                resource: event,
            }));
    }, [eventsData, selectedGames, resolved]);

    // Navigation handlers
    const handleNavigate = useCallback((date: Date) => {
        setCurrentDate(date);
    }, [setCurrentDate]);

    // Navigate prev (day, week, or month based on current view)
    const handlePrev = useCallback(() => {
        if (view === Views.DAY) {
            setCurrentDate(subDays(currentDate, 1));
        } else if (view === Views.WEEK) {
            setCurrentDate(subWeeks(currentDate, 1));
        } else {
            setCurrentDate(subMonths(currentDate, 1));
        }
    }, [currentDate, setCurrentDate, view]);

    // Navigate next (day, week, or month based on current view)
    const handleNext = useCallback(() => {
        if (view === Views.DAY) {
            setCurrentDate(addDays(currentDate, 1));
        } else if (view === Views.WEEK) {
            setCurrentDate(addWeeks(currentDate, 1));
        } else {
            setCurrentDate(addMonths(currentDate, 1));
        }
    }, [currentDate, setCurrentDate, view]);

    const handleToday = useCallback(() => {
        setCurrentDate(new Date());
    }, [setCurrentDate]);

    // Event click handler — pass calendar context so event detail page can navigate back
    const handleSelectEvent = useCallback(
        (event: CalendarEvent) => {
            const viewStr = view === Views.WEEK ? 'week' : view === Views.DAY ? 'day' : 'month';
            const dateStr = format(currentDate, 'yyyy-MM-dd');
            navigate(`/events/${event.id}`, {
                state: { fromCalendar: true, calendarDate: dateStr, calendarView: viewStr },
            });
        },
        [navigate, view, currentDate]
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

    // Helper: check if an event overlaps with game time slots
    const eventOverlapsGameTime = useCallback(
        (start: Date, end: Date): boolean => {
            if (!gameTimeSlots) return false;
            const cursor = new Date(start);
            cursor.setMinutes(0, 0, 0);
            if (cursor < start) cursor.setHours(cursor.getHours() + 1);
            while (cursor < end) {
                // Grid convention is now 0=Sun (matches JS getDay())
                const gridDay = cursor.getDay();
                if (gameTimeSlots.has(`${gridDay}:${cursor.getHours()}`)) return true;
                cursor.setHours(cursor.getHours() + 1);
            }
            return false;
        },
        [gameTimeSlots],
    );

    // Custom event component for MONTH view (compact chip)
    const MonthEventComponent = useCallback(
        ({ event }: { event: CalendarEvent }) => {
            const gameSlug = event.resource?.game?.slug || 'default';
            const coverUrl = event.resource?.game?.coverUrl;
            const colors = getGameColors(gameSlug);
            const overlaps = eventOverlapsGameTime(event.start, event.end);

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
                    {overlaps && (
                        <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mr-0.5"
                            style={{ boxShadow: '0 0 4px rgba(52, 211, 153, 0.6)' }}
                            title="Overlaps with your game time"
                        />
                    )}
                    <span className="event-chip-time">{timeStr}</span>
                    <span className="event-chip-title">{event.title}</span>
                </div>
            );
        },
        [eventOverlapsGameTime]
    );

    // Custom event component for WEEK view — delegates to extracted WeekEventCard
    const WeekEventWrapper = useCallback(
        ({ event }: { event: CalendarEvent }) => (
            <WeekEventCard event={event} eventOverlapsGameTime={eventOverlapsGameTime} />
        ),
        [eventOverlapsGameTime],
    );

    // ROK-191: Day event wrapper — passes eventOverlapsGameTime to the extracted DayEventCard
    const DayEventWrapper = useCallback(
        ({ event }: { event: CalendarEvent }) => (
            <DayEventCard event={event} eventOverlapsGameTime={eventOverlapsGameTime} />
        ),
        [eventOverlapsGameTime],
    );

    return (
        <div className={`calendar-container calendar-view-${view} ${className}`}>
            {/* Custom Toolbar */}
            <div className="calendar-toolbar">
                <div className="toolbar-nav">
                    <button
                        onClick={handlePrev}
                        className="toolbar-btn"
                        aria-label={view === Views.DAY ? 'Previous day' : view === Views.WEEK ? 'Previous week' : 'Previous month'}
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
                        onClick={handleNext}
                        className="toolbar-btn"
                        aria-label={view === Views.DAY ? 'Next day' : view === Views.WEEK ? 'Next week' : 'Next month'}
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
                <h2 className="toolbar-title">
                    {view === Views.DAY
                        ? format(currentDate, 'EEEE, MMMM d, yyyy')
                        : view === Views.WEEK
                            ? (() => {
                                const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
                                const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
                                const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
                                return sameMonth
                                    ? `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd, yyyy')}`
                                    : `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
                            })()
                            : format(currentDate, 'MMMM yyyy')
                    }
                </h2>
                <div className="toolbar-views" role="group" aria-label="Calendar view">
                    <span className="toolbar-btn text-xs text-muted pointer-events-none" aria-label={`Times shown in ${tzAbbr}`}>
                        {tzAbbr}
                    </span>
                    <button
                        type="button"
                        className={`toolbar-btn ${view === Views.MONTH ? 'active' : ''}`}
                        onClick={() => setView(Views.MONTH)}
                        aria-pressed={view === Views.MONTH}
                    >
                        Month
                    </button>
                    <button
                        type="button"
                        className={`toolbar-btn ${view === Views.WEEK ? 'active' : ''}`}
                        onClick={() => setView(Views.WEEK)}
                        aria-pressed={view === Views.WEEK}
                    >
                        Week
                    </button>
                    <button
                        type="button"
                        className={`toolbar-btn ${view === Views.DAY ? 'active' : ''}`}
                        onClick={() => setView(Views.DAY)}
                        aria-pressed={view === Views.DAY}
                    >
                        Day
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
                    key={view}
                    localizer={localizer}
                    events={calendarEvents}
                    date={currentDate}
                    view={view}
                    views={[Views.MONTH, Views.WEEK, Views.DAY]}
                    onNavigate={handleNavigate}
                    onView={setView}
                    onSelectEvent={handleSelectEvent}
                    eventPropGetter={eventPropGetter}
                    components={{
                        month: { event: MonthEventComponent },
                        week: { event: WeekEventWrapper },
                        day: { event: DayEventWrapper }, // ROK-191: Interactive day view with quick-join
                        toolbar: () => null, // Hide default toolbar
                    }}
                    getNow={() => new TZDate(Date.now(), resolved)}
                    popup
                    selectable={false}
                    scrollToTime={new Date(0, 0, 0, 8, 0)} // Scroll to 8 AM on mount
                    min={new Date(0, 0, 0, 6, 0)}   // 6 AM
                    max={new Date(0, 0, 0, 23, 0)}  // 11 PM
                    style={{ minHeight: '500px' }}
                />
            </div>

            {/* Empty State */}
            {!isLoading && calendarEvents.length === 0 && (
                <div className="calendar-empty">
                    <div className="empty-icon">📅</div>
                    <p>No events {view === Views.DAY ? 'today' : view === Views.WEEK ? 'this week' : 'this month'}</p>
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
