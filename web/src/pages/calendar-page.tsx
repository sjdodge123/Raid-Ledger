import { useState, useCallback, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarView, MiniCalendar, type GameInfo } from '../components/calendar';
import { getGameColors } from '../constants/game-colors';
import { useGameTime } from '../hooks/use-game-time';
import { useAuth } from '../hooks/use-auth';
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
    const [availableGames, setAvailableGames] = useState<GameInfo[]>([]);
    const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());

    // Track if we've done the initial auto-select (so "None" doesn't re-trigger it)
    const hasInitialized = useRef(false);

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

    // Handler for when calendar reports available games
    // Show only games from current view, but persist selections
    const handleGamesAvailable = useCallback((games: GameInfo[]) => {
        // Update available games to show only current view
        setAvailableGames(games);

        // Auto-select all games on first load
        if (!hasInitialized.current && games.length > 0) {
            hasInitialized.current = true;
            setSelectedGames(new Set(games.map(g => g.slug)));
        } else {
            // For subsequent loads, auto-select any NEW games that weren't previously selected
            setSelectedGames(prev => {
                const next = new Set(prev);
                games.forEach(g => {
                    // Add games that are new (not already in selection)
                    if (!prev.has(g.slug)) {
                        next.add(g.slug);
                    }
                });
                return next;
            });
        }
    }, []);

    // Toggle a single game filter
    const toggleGame = (slug: string) => {
        setSelectedGames(prev => {
            const next = new Set(prev);
            if (next.has(slug)) {
                next.delete(slug);
            } else {
                next.add(slug);
            }
            return next;
        });
    };

    // Select all games
    const selectAllGames = () => {
        setSelectedGames(new Set(availableGames.map(g => g.slug)));
    };

    // Deselect all games
    const deselectAllGames = () => {
        setSelectedGames(new Set());
    };

    return (
        <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="mb-6">
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
                    {availableGames.length > 0 && (
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
                                {availableGames.map((game) => {
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
                <main>
                    <CalendarView
                        currentDate={currentDate}
                        onDateChange={setCurrentDate}
                        selectedGames={selectedGames}
                        onGamesAvailable={handleGamesAvailable}
                        gameTimeSlots={gameTimeSlots}
                    />
                </main>
            </div>
        </div>
    );
}
