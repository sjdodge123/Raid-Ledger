import type { JSX } from 'react';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, subDays, addMonths, subMonths } from 'date-fns';
import { FunnelIcon } from '@heroicons/react/24/outline';
import { CalendarView, MiniCalendar } from '../components/calendar';
import { CalendarMobileToolbar, type CalendarViewMode } from '../components/calendar/calendar-mobile-toolbar';
import { CalendarMobileNav } from '../components/calendar/calendar-mobile-nav';
import { CalendarFilterChip } from '../components/calendar/calendar-filter-chip';
import { FAB } from '../components/ui/fab';
import { useGameTime } from '../hooks/use-game-time';
import { useAuth } from '../hooks/use-auth';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useGameFilterStore } from '../stores/game-filter-store';
import { useLikedGameSlugs } from '../hooks/use-liked-game-slugs';
import { CalendarGameFilterSheet, CalendarGameFilterModal } from './calendar/CalendarGameFilter';
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
    const [gameFilterOpen, setGameFilterOpen] = useState(false);
    const [filterModalOpen, setFilterModalOpen] = useState(false);

    const handleMobileNavPrev = useCallback(() => {
        setCurrentDate((prev) => calendarView === 'day' ? subDays(prev, 1) : subMonths(prev, 1));
    }, [calendarView]);
    const handleMobileNavNext = useCallback(() => {
        setCurrentDate((prev) => calendarView === 'day' ? addDays(prev, 1) : addMonths(prev, 1));
    }, [calendarView]);
    const handleMobileNavToday = useCallback(() => setCurrentDate(new Date()), []);

    return {
        currentDate, setCurrentDate, calendarView, setCalendarView,
        gameFilterOpen, setGameFilterOpen, filterModalOpen, setFilterModalOpen,
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

    const allKnownGames = useGameFilterStore((s) => s.allKnownGames);
    const selectedGames = useGameFilterStore((s) => s.selectedGames);
    const toggleGame = useGameFilterStore((s) => s.toggleGame);
    const selectAllGames = useGameFilterStore((s) => s.selectAll);
    const deselectAllGames = useGameFilterStore((s) => s.deselectAll);
    const likedSlugs = useLikedGameSlugs();

    const filterProps = { allKnownGames, selectedGames, toggleGame, selectAllGames, deselectAllGames, likedSlugs };

    return <CalendarPageLayout state={state} gameTimeSlots={gameTimeSlots} filterProps={filterProps} />;
}

interface GameItem { slug: string; name: string; coverUrl: string | null }
interface FilterProps {
    allKnownGames: GameItem[]; selectedGames: Set<string>; toggleGame: (s: string) => void;
    selectAllGames: () => void; deselectAllGames: () => void; likedSlugs: Set<string>;
}

function CalendarPageLayout({ state, gameTimeSlots, filterProps }: {
    state: ReturnType<typeof useCalendarState>; gameTimeSlots: Set<string> | undefined;
    filterProps: FilterProps;
}): JSX.Element {
    return (
        <div className="pb-20 md:pb-0" style={{ overflowX: 'clip' }}>
            <CalendarMobileToolbar activeView={state.calendarView} onViewChange={state.setCalendarView} />
            <CalendarMobileNav currentDate={state.currentDate} calendarView={state.calendarView} onPrev={state.handleMobileNavPrev} onNext={state.handleMobileNavNext} onToday={state.handleMobileNavToday} />
            <CalendarMainContent state={state} gameTimeSlots={gameTimeSlots} filterProps={filterProps} />
            {filterProps.allKnownGames.length > 0 && <FAB onClick={() => state.setGameFilterOpen(true)} icon={FunnelIcon} label="Filter by Game" />}
            <CalendarGameFilterSheet isOpen={state.gameFilterOpen} onClose={() => state.setGameFilterOpen(false)}
                allKnownGames={filterProps.allKnownGames} selectedGames={filterProps.selectedGames}
                toggleGame={filterProps.toggleGame} selectAllGames={filterProps.selectAllGames}
                deselectAllGames={filterProps.deselectAllGames} likedSlugs={filterProps.likedSlugs} />
            <CalendarGameFilterModal isOpen={state.filterModalOpen} onClose={() => state.setFilterModalOpen(false)}
                allKnownGames={filterProps.allKnownGames} selectedGames={filterProps.selectedGames}
                toggleGame={filterProps.toggleGame} selectAllGames={filterProps.selectAllGames}
                deselectAllGames={filterProps.deselectAllGames} likedSlugs={filterProps.likedSlugs} />
        </div>
    );
}

function CalendarMainContent({ state, gameTimeSlots, filterProps }: {
    state: ReturnType<typeof useCalendarState>; gameTimeSlots: Set<string> | undefined;
    filterProps: FilterProps;
}): JSX.Element {
    return (
        <div className={`max-w-7xl mx-auto ${state.calendarView === 'schedule' ? 'py-0 md:py-6 md:px-4' : 'px-2 py-1 md:px-4 md:py-6'}`} style={{ overflowX: 'clip' }}>
            <div className={`mb-6 hidden md:block ${state.calendarView === 'schedule' ? 'px-4' : ''}`}>
                <h1 className="text-3xl font-bold text-foreground">Calendar</h1>
                <p className="text-muted mt-1">View upcoming events and plan your schedule</p>
            </div>
            <div className="calendar-page-layout">
                <CalendarSidebar currentDate={state.currentDate} onDateSelect={state.setCurrentDate}
                    onShowFilterModal={() => state.setFilterModalOpen(true)} {...filterProps} />
                <main className="min-w-0">
                    <CalendarView currentDate={state.currentDate} onDateChange={state.setCurrentDate} selectedGames={filterProps.selectedGames}
                        gameTimeSlots={gameTimeSlots} calendarView={state.calendarView} onCalendarViewChange={state.setCalendarView} />
                </main>
            </div>
        </div>
    );
}

/** Desktop sidebar with mini calendar, filter chip, and quick actions */
function CalendarSidebar({ currentDate, onDateSelect, allKnownGames, selectedGames, onShowFilterModal }: {
    currentDate: Date; onDateSelect: (d: Date) => void;
    allKnownGames: GameItem[]; selectedGames: Set<string>;
    toggleGame: (s: string) => void; selectAllGames: () => void; deselectAllGames: () => void;
    likedSlugs: Set<string>;
    onShowFilterModal: () => void;
}): JSX.Element {
    return (
        <aside className="calendar-sidebar">
            <MiniCalendar currentDate={currentDate} onDateSelect={onDateSelect} />
            {allKnownGames.length > 0 && (
                <div className="sidebar-section">
                    <CalendarFilterChip allKnownGames={allKnownGames} selectedGames={selectedGames}
                        onOpen={onShowFilterModal} />
                </div>
            )}
            <SidebarQuickActions />
        </aside>
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
