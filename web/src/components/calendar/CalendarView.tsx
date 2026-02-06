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
    differenceInMinutes,
} from 'date-fns';
import { enUS } from 'date-fns/locale';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEvents } from '../../hooks/use-events';
import { getGameColors, getCalendarEventStyle } from '../../constants/game-colors';
import { AttendeeAvatars } from './AttendeeAvatars';
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
    const [searchParams, setSearchParams] = useSearchParams();
    const [internalDate, setInternalDate] = useState(new Date());

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
                start: new Date(event.startTime),
                end: event.endTime ? new Date(event.endTime) : new Date(event.startTime),
                resource: event,
            }));
    }, [eventsData, selectedGames]);

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

    // Custom event component for MONTH view (compact chip)
    const MonthEventComponent = useCallback(
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

    // Custom event component for WEEK view (full block with details)
    const WeekEventComponent = useCallback(
        ({ event }: { event: CalendarEvent }) => {
            const gameSlug = event.resource?.game?.slug || 'default';
            const coverUrl = event.resource?.game?.coverUrl;
            const gameName = event.resource?.game?.name || 'Event';
            const signupCount = event.resource?.signupCount ?? 0;
            const signupsPreview = event.resource?.signupsPreview;
            const creatorName = event.resource?.creator?.username;
            const colors = getGameColors(gameSlug);

            // Format time range (e.g., "7:00 AM - 10:00 AM")
            const startTime = format(event.start, 'h:mm a');
            const endTime = event.end ? format(event.end, 'h:mm a') : '';

            // Calculate event duration in hours - only show avatars for events 2+ hours
            const durationHours = event.end
                ? (event.end.getTime() - event.start.getTime()) / (1000 * 60 * 60)
                : 0;
            const showAvatars = durationHours >= 2;

            return (
                <div
                    className="week-event-block"
                    style={{
                        backgroundImage: coverUrl
                            ? `linear-gradient(180deg, ${colors.bg}f5 0%, ${colors.bg}ee 60%, ${colors.bg}cc 100%), url(${coverUrl})`
                            : `linear-gradient(180deg, ${colors.bg} 0%, ${colors.bg}dd 100%)`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        borderLeft: `3px solid ${colors.border}`,
                    }}
                >
                    <div className="week-event-header">
                        <span className="week-event-title">{event.title}</span>
                    </div>
                    <div className="week-event-details">
                        <span className="week-event-game">{gameName}</span>
                        <span className="week-event-time">
                            {startTime}{endTime ? ` - ${endTime}` : ''}
                        </span>
                        {creatorName && (
                            <span className="week-event-creator">by {creatorName}</span>
                        )}
                        {/* ROK-177: Attendee avatars with signup preview - only for events 2+ hours */}
                        {showAvatars && signupsPreview && signupsPreview.length > 0 ? (
                            <div className="week-event-attendees">
                                <AttendeeAvatars
                                    signups={signupsPreview}
                                    totalCount={signupCount}
                                    size="sm"
                                    accentColor={colors.border}
                                />
                            </div>
                        ) : signupCount > 0 ? (
                            <span className="week-event-signups">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '4px', verticalAlign: 'middle' }}>
                                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                                </svg>
                                {signupCount} signed up
                            </span>
                        ) : null}
                    </div>
                </div>
            );
        },
        []
    );

    // Custom event component for DAY view (expanded with centered art + description)
    const DayEventComponent = useCallback(
        ({ event }: { event: CalendarEvent }) => {
            const gameSlug = event.resource?.game?.slug || 'default';
            const coverUrl = event.resource?.game?.coverUrl;
            const gameName = event.resource?.game?.name || 'Event';
            const signupCount = event.resource?.signupCount ?? 0;
            const signupsPreview = event.resource?.signupsPreview;
            const description = event.resource?.description || '';
            const creatorName = event.resource?.creator?.username;
            const colors = getGameColors(gameSlug);



            // Format time range (e.g., "7:00 AM - 10:00 AM")
            const startTime = format(event.start, 'h:mm a');
            const endTime = event.end ? format(event.end, 'h:mm a') : '';

            // Calculate duration
            const durationMins = event.end ? differenceInMinutes(event.end, event.start) : 0;
            const hours = Math.floor(durationMins / 60);
            const mins = durationMins % 60;
            const durationStr = hours > 0
                ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`)
                : `${mins}m`;

            // Truncate description for preview
            const descriptionPreview = description.length > 80
                ? `${description.slice(0, 80)}...`
                : description;

            return (
                <div
                    className="day-event-block"
                    style={{
                        // Centered art with horizontal edge fades - subtle art treatment
                        backgroundImage: coverUrl
                            ? `linear-gradient(90deg, ${colors.bg}f5 0%, ${colors.bg}dd 20%, ${colors.bg}aa 40%, ${colors.bg}aa 60%, ${colors.bg}dd 80%, ${colors.bg}f5 100%), url(${coverUrl})`
                            : `linear-gradient(90deg, ${colors.bg} 0%, ${colors.bg}dd 100%)`,
                        backgroundSize: 'auto 100%, cover',
                        backgroundPosition: 'center, center',
                        backgroundRepeat: 'no-repeat',
                        borderLeft: `4px solid ${colors.border}`,
                    }}
                >
                    <div className="day-event-content">
                        <div className="day-event-header">
                            <span className="day-event-duration">{durationStr}</span>
                            <span className="day-event-title">{event.title}</span>
                        </div>
                        <div className="day-event-meta">
                            <span className="day-event-game">{gameName}</span>
                            <span className="day-event-time">
                                {startTime}{endTime ? ` - ${endTime}` : ''}
                            </span>
                            {creatorName && (
                                <span className="day-event-creator">by {creatorName}</span>
                            )}
                        </div>
                        {descriptionPreview && (
                            <p className="day-event-description">{descriptionPreview}</p>
                        )}
                        {/* ROK-177: Attendee avatars in day view footer */}
                        <div className="day-event-footer">
                            {signupsPreview && signupsPreview.length > 0 ? (
                                <AttendeeAvatars
                                    signups={signupsPreview}
                                    totalCount={signupCount}
                                    size="md"
                                    accentColor={colors.border}
                                />
                            ) : signupCount > 0 ? (
                                <span className="day-event-signups">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                                        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                                    </svg>
                                    {signupCount} signed up
                                </span>
                            ) : null}
                        </div>
                    </div>
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
                        week: { event: WeekEventComponent },
                        day: { event: DayEventComponent }, // Enhanced day view with centered art
                        toolbar: () => null, // Hide default toolbar
                    }}
                    popup
                    selectable={false}
                    min={new Date(0, 0, 0, 6, 0)}   // 6 AM
                    max={new Date(0, 0, 0, 23, 0)}  // 11 PM
                    style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}
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
