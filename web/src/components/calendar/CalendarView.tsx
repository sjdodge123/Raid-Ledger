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
import { useCalendarViewStore, type CalendarViewPref } from '../../stores/calendar-view-store';
import { toZonedDate, getTimezoneAbbr } from '../../lib/timezone-utils';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { Z_INDEX } from '../../lib/z-index';
import { TZDate } from '@date-fns/tz';
import { DayEventCard } from './DayEventCard';
import { WeekEventCard } from './WeekEventCard';
import { ScheduleView } from './ScheduleView';
import type { CalendarViewMode } from './calendar-mobile-toolbar';
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
    /** Mobile calendar view mode (schedule/month/day) — when 'schedule', renders ScheduleView */
    calendarView?: CalendarViewMode;
    /** Callback to sync view changes back to mobile toolbar (ROK-368) */
    onCalendarViewChange?: (view: CalendarViewMode) => void;
}

export function CalendarView({
    className = '',
    currentDate: controlledDate,
    onDateChange,
    selectedGames,
    onGamesAvailable,
    gameTimeSlots,
    calendarView,
    onCalendarViewChange,
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

    // Scroll direction for sticky calendar toolbar on mobile (ROK-360)
    const scrollDirection = useScrollDirection();
    const isHeaderHidden = scrollDirection === 'down';

    // View state from Zustand store, with URL param override
    const viewPref = useCalendarViewStore((s) => s.viewPref);
    const setViewPref = useCalendarViewStore((s) => s.setViewPref);

    const VIEW_MAP: Record<string, View> = { week: Views.WEEK, day: Views.DAY, month: Views.MONTH };
    const urlViewParam = searchParams.get('view');
    const urlView = urlViewParam ? VIEW_MAP[urlViewParam] : undefined;
    const view: View = urlView ?? VIEW_MAP[viewPref] ?? Views.WEEK;

    const setView = useCallback((newView: View) => {
        const viewStr: CalendarViewPref = newView === Views.WEEK ? 'week' : newView === Views.DAY ? 'day' : 'month';
        setViewPref(viewStr);
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('view', viewStr);
            return next;
        }, { replace: true });
    }, [setViewPref, setSearchParams]);

    // Sync date changes to URL (same replace pattern as view)
    useEffect(() => {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('date', dateStr);
            return next;
        }, { replace: true });
    }, [currentDate, setSearchParams]);



    // Sync mobile toolbar view mode to internal react-big-calendar view
    useEffect(() => {
        if (!calendarView || calendarView === 'schedule') return;
        const mapped = VIEW_MAP[calendarView];
        if (mapped && mapped !== view) {
            setView(mapped);
        }
    }, [calendarView]); // eslint-disable-line react-hooks/exhaustive-deps

    // Calculate date range for current view (month, week, day, or schedule)
    const isScheduleView = calendarView === 'schedule';
    const { startAfter, endBefore } = useMemo(() => {
        if (isScheduleView) {
            // Schedule view shows continuous scrollable agenda
            const start = startOfMonth(currentDate);
            const end = endOfMonth(addMonths(currentDate, 2));
            return {
                startAfter: start.toISOString(),
                endBefore: end.toISOString(),
            };
        }
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
    }, [currentDate, view, isScheduleView]);

    // Fetch events for the current month
    // ROK-177: Include signups preview for week/day views to show attendee avatars
    const { data: eventsData, isLoading } = useEvents({
        startAfter,
        endBefore,
        upcoming: false, // Get all events in range, not just upcoming
        includeSignups: isScheduleView || view === Views.WEEK || view === Views.DAY,
        limit: 100, // Override default page size (20) to fetch full date range
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
                // ROK-469: Defensive filter — exclude cancelled events client-side
                if (event.cancelledAt) return false;
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
    // On mobile month view, tapping an event drills down to day view instead of navigating to detail
    const handleSelectEvent = useCallback(
        (event: CalendarEvent) => {
            const isMobile = window.innerWidth < 768;
            if (isMobile && view === Views.MONTH) {
                setCurrentDate(event.start);
                setView(Views.DAY);
                onCalendarViewChange?.('day');
                return;
            }
            const viewStr = isScheduleView
                ? 'schedule'
                : view === Views.WEEK ? 'week' : view === Views.DAY ? 'day' : 'month';
            const dateStr = format(currentDate, 'yyyy-MM-dd');
            navigate(`/events/${event.id}`, {
                state: { fromCalendar: true, calendarDate: dateStr, calendarView: viewStr },
            });
        },
        [navigate, view, currentDate, isScheduleView, setCurrentDate, setView, onCalendarViewChange]
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

    // Mobile month drill-down: tapping an event chip drills to day view
    const handleMonthChipClick = useCallback(
        (e: React.MouseEvent, eventStart: Date) => {
            if (window.innerWidth >= 768) return; // desktop: let onSelectEvent handle it
            e.stopPropagation();
            e.preventDefault();
            setCurrentDate(eventStart);
            setView(Views.DAY);
            onCalendarViewChange?.('day');
        },
        [setCurrentDate, setView, onCalendarViewChange],
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
                    onClick={(e) => handleMonthChipClick(e, event.start)}
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
        [eventOverlapsGameTime, handleMonthChipClick]
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

    // Schedule view — mobile agenda list (no calendar-container wrapper to avoid inherited padding/border)
    if (isScheduleView) {
        return (
            <div className={`min-w-0 ${className}`}>
                {isLoading && (
                    <div className="flex items-center justify-center py-16 gap-2 text-muted">
                        <div className="loading-spinner" />
                        <span>Loading events...</span>
                    </div>
                )}
                {!isLoading && (
                    <ScheduleView
                        events={calendarEvents}
                        currentDate={currentDate}
                        onDateChange={setCurrentDate}
                        onSelectEvent={handleSelectEvent}
                        eventOverlapsGameTime={eventOverlapsGameTime}
                    />
                )}
            </div>
        );
    }

    return (
        <div className={`calendar-container calendar-view-${view} ${className}`}>
            {/* Custom Toolbar — hidden on mobile where CalendarMobileToolbar provides navigation */}
            <div
                className={`calendar-toolbar ${calendarView ? 'calendar-toolbar-desktop-only' : 'sticky md:static'}`}
                style={{
                    top: isHeaderHidden ? '4.25rem' : '8.25rem',
                    zIndex: Z_INDEX.TOOLBAR,
                    transition: 'top 300ms ease-in-out',
                }}
            >
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
                <div className="toolbar-views hidden md:flex" role="group" aria-label="Calendar view">
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
                    onDrillDown={(date) => {
                        setCurrentDate(date);
                        setView(Views.DAY);
                        onCalendarViewChange?.('day');
                    }}
                    drilldownView={Views.DAY}
                    eventPropGetter={eventPropGetter}
                    components={{
                        month: { event: MonthEventComponent },
                        week: { event: WeekEventWrapper },
                        day: { event: DayEventWrapper }, // ROK-191: Interactive day view with quick-join
                        toolbar: () => null, // Hide default toolbar
                    }}
                    getNow={() => new TZDate(Date.now(), resolved)}
                    allDayAccessor={() => false}
                    popup
                    selectable
                    onSelectSlot={(slotInfo) => {
                        const isMobile = window.innerWidth < 768;
                        if (slotInfo.action === 'doubleClick' || (isMobile && slotInfo.action === 'click' && view === Views.MONTH)) {
                            setCurrentDate(slotInfo.start);
                            setView(Views.DAY);
                            onCalendarViewChange?.('day');
                        }
                    }}
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
