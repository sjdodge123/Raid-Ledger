import type { JSX, ReactNode } from 'react';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, subDays, addMonths, subMonths } from 'date-fns';
import { CalendarView, MiniCalendar } from '../components/calendar';
import { CalendarMobileToolbar, type CalendarViewMode } from '../components/calendar/calendar-mobile-toolbar';
import { CalendarMobileNav } from '../components/calendar/calendar-mobile-nav';
import { useGameTime } from '../hooks/use-game-time';
import { useAuth } from '../hooks/use-auth';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useGameFilterStore } from '../stores/game-filter-store';
import { useMediaQuery } from '../hooks/use-media-query';
import { DESKTOP_MQ } from '../lib/breakpoints';
import { CalendarFilterEntry, CalendarFilterTrigger } from './calendar/CalendarFilterEntry';
import { useCalendarGameFilter, type CalendarGameFilter } from './calendar/use-calendar-game-filter';
import '../components/calendar/calendar-styles.css';

/**
 * Calendar page - displays events in a month grid view.
 * ROK-171: Calendar Month View
 */
function useCalendarState() {
    const [searchParams] = useSearchParams();
    const [currentDate, setCurrentDate] = useState(() => {
        const dateStr = searchParams.get('date');
        if (dateStr) {
            const parsed = new Date(dateStr + 'T00:00:00');
            if (!isNaN(parsed.getTime())) return parsed;
        }
        return new Date();
    });
    const [calendarView, setCalendarView] = useState<CalendarViewMode>(
        () => typeof window !== 'undefined' && window.innerWidth < 768 ? 'schedule' : 'month'
    );
    const [filtersOpen, setFiltersOpen] = useState(false);

    const handleMobileNavPrev = useCallback(() => {
        setCurrentDate((prev) => calendarView === 'day' ? subDays(prev, 1) : subMonths(prev, 1));
    }, [calendarView]);
    const handleMobileNavNext = useCallback(() => {
        setCurrentDate((prev) => calendarView === 'day' ? addDays(prev, 1) : addMonths(prev, 1));
    }, [calendarView]);
    const handleMobileNavToday = useCallback(() => setCurrentDate(new Date()), []);

    return {
        currentDate, setCurrentDate, calendarView, setCalendarView,
        filtersOpen, setFiltersOpen,
        handleMobileNavPrev, handleMobileNavNext, handleMobileNavToday,
    };
}

function useGameTimeSlots(): Set<string> | undefined {
    const { isAuthenticated } = useAuth();
    const { data: gameTimeData } = useGameTime({ enabled: isAuthenticated });
    return useMemo(() => {
        if (!gameTimeData?.slots) return undefined;
        const set = new Set<string>();
        for (const s of gameTimeData.slots) {
            if (s.status === 'available' || !s.status) set.add(`${s.dayOfWeek}:${s.hour}`);
        }
        return set.size > 0 ? set : undefined;
    }, [gameTimeData]);
}

function useSyncGameRegistry() {
    const { games: registryGames } = useGameRegistry();
    useEffect(() => {
        if (registryGames.length > 0) {
            useGameFilterStore.getState().reportGames(
                registryGames.map((g) => ({ slug: g.slug, name: g.name, coverUrl: g.coverUrl })),
            );
        }
    }, [registryGames]);
}

/** Save filter to preferences after user-initiated changes (debounced 500ms). */
function useSaveOnFilterChange(): void {
    const saveFilter = useGameFilterStore((s) => s.saveFilter);
    const selectedGames = useGameFilterStore((s) => s.selectedGames);
    const hasInitialized = useGameFilterStore((s) => s.hasInitialized);
    const lastChangeSource = useGameFilterStore((s) => s.lastChangeSource);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!hasInitialized || lastChangeSource !== 'user') return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { saveFilter(); }, 500);
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: only save when selection changes
    }, [selectedGames]);
}

export function CalendarPage(): JSX.Element {
    const state = useCalendarState();
    const gameTimeSlots = useGameTimeSlots();
    useSyncGameRegistry();
    useSaveOnFilterChange();
    const filter = useCalendarGameFilter();
    const isDesktop = useMediaQuery(DESKTOP_MQ);

    return <CalendarPageLayout state={state} gameTimeSlots={gameTimeSlots} filter={filter} isDesktop={isDesktop} />;
}

type CalendarState = ReturnType<typeof useCalendarState>;

/**
 * ROK-1662: one Filters entry. At 1024px and up the funnel sits at the right
 * end of the calendar toolbar and the panel opens under it; below 1024px the
 * same entry is the Filters FAB + BottomSheet (bottom padding clears the FAB).
 */
function CalendarPageLayout({ state, gameTimeSlots, filter, isDesktop }: {
    state: CalendarState; gameTimeSlots: Set<string> | undefined;
    filter: CalendarGameFilter; isDesktop: boolean;
}): JSX.Element {
    const entry = <CalendarFilterEntry filter={filter} isOpen={state.filtersOpen} onOpenChange={state.setFiltersOpen} />;
    const trigger = <CalendarFilterTrigger filter={filter} isOpen={state.filtersOpen} onOpenChange={state.setFiltersOpen} />;
    return (
        <div className="pb-20 lg:pb-0" style={{ overflowX: 'clip' }}>
            <CalendarMobileToolbar activeView={state.calendarView} onViewChange={state.setCalendarView} />
            <CalendarMobileNav currentDate={state.currentDate} calendarView={state.calendarView} onPrev={state.handleMobileNavPrev} onNext={state.handleMobileNavNext} onToday={state.handleMobileNavToday} />
            <CalendarMainContent state={state} gameTimeSlots={gameTimeSlots} selectedGames={filter.selectedGames}
                toolbarAction={trigger} belowToolbar={isDesktop ? entry : null} />
            {!isDesktop && entry}
        </div>
    );
}

function CalendarMainContent({ state, gameTimeSlots, selectedGames, toolbarAction, belowToolbar }: {
    state: CalendarState; gameTimeSlots: Set<string> | undefined; selectedGames: Set<string>;
    toolbarAction: ReactNode; belowToolbar: ReactNode;
}): JSX.Element {
    return (
        <div className={`max-w-7xl mx-auto ${state.calendarView === 'schedule' ? 'py-0 md:py-6 md:px-4' : 'px-2 py-1 md:px-4 md:py-6'}`} style={{ overflowX: 'clip' }}>
            <div className={`mb-6 hidden md:block ${state.calendarView === 'schedule' ? 'px-4' : ''}`}>
                <h1 className="text-3xl font-bold text-foreground">Calendar</h1>
                <p className="text-muted mt-1">View upcoming events and plan your schedule</p>
            </div>
            <div className="calendar-page-layout">
                <aside className="calendar-sidebar">
                    <MiniCalendar currentDate={state.currentDate} onDateSelect={state.setCurrentDate} />
                    <SidebarQuickActions />
                </aside>
                <main className="min-w-0">
                    <CalendarView currentDate={state.currentDate} onDateChange={state.setCurrentDate} selectedGames={selectedGames}
                        gameTimeSlots={gameTimeSlots} calendarView={state.calendarView} onCalendarViewChange={state.setCalendarView}
                        toolbarAction={toolbarAction} belowToolbar={belowToolbar} />
                </main>
            </div>
        </div>
    );
}

function SidebarQuickActions(): JSX.Element {
    return (
        <div className="sidebar-section">
            <h3 className="sidebar-section-title">Quick Actions</h3>
            <div className="sidebar-quick-actions">
                <Link to="/events/new" className="sidebar-action-btn">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    Create Event
                </Link>
                <Link to="/events" className="sidebar-action-btn">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                    All Events
                </Link>
            </div>
        </div>
    );
}
