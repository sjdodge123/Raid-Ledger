import { useState, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, subDays, addMonths, subMonths } from 'date-fns';
import { FunnelIcon } from '@heroicons/react/24/outline';
import { CalendarView, MiniCalendar } from '../components/calendar';
import { CalendarMobileToolbar, type CalendarViewMode } from '../components/calendar/calendar-mobile-toolbar';
import { CalendarMobileNav } from '../components/calendar/calendar-mobile-nav';
import { FAB } from '../components/ui/fab';
import { BottomSheet } from '../components/ui/bottom-sheet';
import { Modal } from '../components/ui/modal';
import { getGameColors } from '../constants/game-colors';
import { useGameTime } from '../hooks/use-game-time';
import { useAuth } from '../hooks/use-auth';
import { useGameFilterStore } from '../stores/game-filter-store';
import '../components/calendar/calendar-styles.css';

/**
 * Calendar page - displays events in a month grid view.
 * ROK-171: Calendar Month View
 */
export function CalendarPage() {
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
    const [filterSearch, setFilterSearch] = useState('');

    // Game filter state lives in a Zustand store so it survives component remounts
    // (React StrictMode, HMR, Suspense boundaries, etc.)
    const allKnownGames = useGameFilterStore((s) => s.allKnownGames);
    const selectedGames = useGameFilterStore((s) => s.selectedGames);
    const reportGames = useGameFilterStore((s) => s.reportGames);
    const toggleGame = useGameFilterStore((s) => s.toggleGame);
    const selectAllGames = useGameFilterStore((s) => s.selectAll);
    const deselectAllGames = useGameFilterStore((s) => s.deselectAll);

    // Hard cap — show at most 5 games inline, overflow to modal
    const maxVisible = 5;

    // Game time overlay for calendar indicator
    const { isAuthenticated } = useAuth();
    const { data: gameTimeData } = useGameTime({ enabled: isAuthenticated });
    const gameTimeSlots = useMemo(() => {
        if (!gameTimeData?.slots) return undefined;
        const set = new Set<string>();
        for (const s of gameTimeData.slots) {
            if (s.status === 'available' || !s.status) {
                set.add(`${s.dayOfWeek}:${s.hour}`);
            }
        }
        return set.size > 0 ? set : undefined;
    }, [gameTimeData]);

    // Handler for mini-calendar date selection
    const handleDateSelect = (date: Date) => {
        setCurrentDate(date);
    };

    // Games to show inline in sidebar (capped)
    const inlineGames = allKnownGames.length > maxVisible
        ? allKnownGames.slice(0, maxVisible)
        : allKnownGames;
    const hasOverflow = allKnownGames.length > maxVisible;

    // Games filtered by search term (for modal)
    const filteredModalGames = useMemo(() => {
        if (!filterSearch.trim()) return allKnownGames;
        const q = filterSearch.toLowerCase();
        return allKnownGames.filter((g) => g.name.toLowerCase().includes(q));
    }, [allKnownGames, filterSearch]);

    // Mobile date navigation handlers
    const handleMobileNavPrev = useCallback(() => {
        setCurrentDate((prev) => calendarView === 'day' ? subDays(prev, 1) : subMonths(prev, 1));
    }, [calendarView]);

    const handleMobileNavNext = useCallback(() => {
        setCurrentDate((prev) => calendarView === 'day' ? addDays(prev, 1) : addMonths(prev, 1));
    }, [calendarView]);

    const handleMobileNavToday = useCallback(() => {
        setCurrentDate(new Date());
    }, []);

    return (
        <div className="pb-20 md:pb-0" style={{ overflowX: 'clip' }}>
            <CalendarMobileToolbar activeView={calendarView} onViewChange={setCalendarView} />
            <CalendarMobileNav
                currentDate={currentDate}
                calendarView={calendarView}
                onPrev={handleMobileNavPrev}
                onNext={handleMobileNavNext}
                onToday={handleMobileNavToday}
            />

            <div className={`max-w-7xl mx-auto ${calendarView === 'schedule' ? 'py-0 md:py-6 md:px-4' : 'px-2 py-1 md:px-4 md:py-6'}`} style={{ overflowX: 'clip' }}>
                <div className={`mb-6 hidden md:block ${calendarView === 'schedule' ? 'px-4' : ''}`}>
                    <h1 className="text-3xl font-bold text-foreground">Calendar</h1>
                    <p className="text-muted mt-1">
                        View upcoming events and plan your schedule
                    </p>
                </div>

                <div className="calendar-page-layout">
                    {/* Sidebar (desktop only) */}
                    <aside className="calendar-sidebar">
                        {/* Mini Calendar Navigator */}
                        <MiniCalendar
                            currentDate={currentDate}
                            onDateSelect={handleDateSelect}
                        />

                        {/* Game Filter Section */}
                        {allKnownGames.length > 0 && (
                            <div className="sidebar-section">
                                <div className="game-filter-header">
                                    <h3 className="sidebar-section-title">Filter by Game</h3>
                                    <div className="game-filter-actions">
                                        <button
                                            type="button"
                                            onClick={selectAllGames}
                                            className="filter-action-btn"
                                            title="Select all"
                                        >
                                            All
                                        </button>
                                        <button
                                            type="button"
                                            onClick={deselectAllGames}
                                            className="filter-action-btn"
                                            title="Deselect all"
                                        >
                                            None
                                        </button>
                                    </div>
                                </div>
                                <div className="game-filter-list">
                                    {inlineGames.map((game) => {
                                        const isSelected = selectedGames.has(game.slug);
                                        const colors = getGameColors(game.slug);
                                        return (
                                            <label
                                                key={game.slug}
                                                className={`game-filter-item ${isSelected ? 'selected' : ''}`}
                                                style={{
                                                    '--game-color': colors.bg,
                                                    '--game-border': colors.border,
                                                } as React.CSSProperties}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleGame(game.slug)}
                                                    className="game-filter-checkbox"
                                                />
                                                <div className="game-filter-icon">
                                                    {game.coverUrl ? (
                                                        <img
                                                            src={game.coverUrl}
                                                            alt={game.name}
                                                            className="game-filter-cover"
                                                        />
                                                    ) : (
                                                        <span className="game-filter-emoji">
                                                            {colors.icon}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="game-filter-name">{game.name}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                                {hasOverflow && (
                                    <button
                                        type="button"
                                        onClick={() => setFilterModalOpen(true)}
                                        className="game-filter-show-all"
                                    >
                                        Show all {allKnownGames.length} games...
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Quick Actions */}
                        <div className="sidebar-section">
                            <h3 className="sidebar-section-title">Quick Actions</h3>
                            <div className="sidebar-quick-actions">
                                <Link to="/events/new" className="sidebar-action-btn">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    Create Event
                                </Link>
                                <Link to="/events" className="sidebar-action-btn">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                    </svg>
                                    All Events
                                </Link>
                            </div>
                        </div>
                    </aside>

                    {/* Main Calendar */}
                    <main className="min-w-0">
                        <CalendarView
                            currentDate={currentDate}
                            onDateChange={setCurrentDate}
                            selectedGames={selectedGames}
                            onGamesAvailable={reportGames}
                            gameTimeSlots={gameTimeSlots}
                            calendarView={calendarView}
                            onCalendarViewChange={setCalendarView}
                        />
                    </main>
                </div>
            </div>

            {allKnownGames.length > 0 && (
                <FAB
                    onClick={() => setGameFilterOpen(true)}
                    icon={FunnelIcon}
                    label="Filter by Game"
                />
            )}

            <BottomSheet
                isOpen={gameFilterOpen}
                onClose={() => setGameFilterOpen(false)}
                title="Filter by Game"
            >
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-muted">
                        {selectedGames.size} of {allKnownGames.length} selected
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={selectAllGames}
                            className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                            All
                        </button>
                        <button
                            type="button"
                            onClick={deselectAllGames}
                            className="text-sm text-muted hover:text-foreground transition-colors"
                        >
                            None
                        </button>
                    </div>
                </div>
                <div className="space-y-1">
                    {allKnownGames.map((game) => {
                        const isSelected = selectedGames.has(game.slug);
                        const colors = getGameColors(game.slug);
                        return (
                            <button
                                key={game.slug}
                                onClick={() => toggleGame(game.slug)}
                                className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg transition-colors ${
                                    isSelected
                                        ? 'bg-emerald-500/10 text-foreground'
                                        : 'text-muted hover:bg-panel'
                                }`}
                            >
                                <div className="w-8 h-8 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center bg-panel">
                                    {game.coverUrl ? (
                                        <img
                                            src={game.coverUrl}
                                            alt={game.name}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <span className="text-sm">{colors.icon}</span>
                                    )}
                                </div>
                                <span className="flex-1 text-left text-sm font-medium">
                                    {game.name}
                                </span>
                                <div
                                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                        isSelected
                                            ? 'bg-emerald-500 border-emerald-500'
                                            : 'border-edge'
                                    }`}
                                >
                                    {isSelected && (
                                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </BottomSheet>

            {/* Desktop overflow modal for game filters */}
            <Modal
                isOpen={filterModalOpen}
                onClose={() => { setFilterModalOpen(false); setFilterSearch(''); }}
                title="Filter by Game"
                maxWidth="max-w-sm"
            >
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted">
                        {selectedGames.size} of {allKnownGames.length} selected
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={selectAllGames}
                            className="filter-action-btn"
                        >
                            All
                        </button>
                        <button
                            type="button"
                            onClick={deselectAllGames}
                            className="filter-action-btn"
                        >
                            None
                        </button>
                    </div>
                </div>
                <input
                    type="text"
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    placeholder="Search games..."
                    className="w-full px-3 py-2 mb-3 rounded-lg bg-base border border-edge text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-emerald-500 transition-colors"
                    autoFocus
                />
                <div className="game-filter-list" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                    {filteredModalGames.map((game) => {
                        const isSelected = selectedGames.has(game.slug);
                        const colors = getGameColors(game.slug);
                        return (
                            <label
                                key={game.slug}
                                className={`game-filter-item ${isSelected ? 'selected' : ''}`}
                                style={{
                                    '--game-color': colors.bg,
                                    '--game-border': colors.border,
                                } as React.CSSProperties}
                            >
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleGame(game.slug)}
                                    className="game-filter-checkbox"
                                />
                                <div className="game-filter-icon">
                                    {game.coverUrl ? (
                                        <img
                                            src={game.coverUrl}
                                            alt={game.name}
                                            className="game-filter-cover"
                                        />
                                    ) : (
                                        <span className="game-filter-emoji">
                                            {colors.icon}
                                        </span>
                                    )}
                                </div>
                                <span className="game-filter-name">{game.name}</span>
                            </label>
                        );
                    })}
                </div>
            </Modal>
        </div>
    );
}
