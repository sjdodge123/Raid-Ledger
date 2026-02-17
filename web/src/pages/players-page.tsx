import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfinitePlayers } from '../hooks/use-players';
import { useGameDetail } from '../hooks/use-games-discover';
import { resolveAvatar, toAvatarUser } from '../lib/avatar';
import { NewMembersSection } from '../components/players/NewMembersSection';
import { MobilePlayerCard } from '../components/players/mobile-player-card';
import { PlayersMobileToolbar } from '../components/players/players-mobile-toolbar';
import { InfiniteScrollSentinel } from '../components/ui/infinite-scroll-sentinel';
import { PullToRefresh } from '../components/ui/pull-to-refresh';

export function PlayersPage() {
    const [searchParams] = useSearchParams();
    const gameIdParam = searchParams.get('gameId');
    const gameId = gameIdParam ? parseInt(gameIdParam, 10) || undefined : undefined;

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const {
        items: players,
        total,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        sentinelRef,
        refetch,
    } = useInfinitePlayers(debouncedSearch, gameId);
    // Fetch game name for the filter banner
    const { data: gameData } = useGameDetail(gameId);

    return (
        <PullToRefresh onRefresh={refetch}>
            <div className="pb-20 md:pb-0">
                <PlayersMobileToolbar searchQuery={search} onSearchChange={setSearch} />

                <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <h1 className="text-2xl font-bold text-foreground">Players</h1>
                        <span className="text-sm text-muted">{total} {gameId ? 'interested' : 'registered'}</span>
                    </div>

                    {/* Game filter banner */}
                    {gameId && gameData && (
                        <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
                            <span className="text-sm text-emerald-400">
                                Showing players interested in <strong>{gameData.name}</strong>
                            </span>
                            <Link
                                to="/players"
                                className="ml-auto text-sm text-muted hover:text-foreground transition-colors"
                            >
                                Clear filter
                            </Link>
                        </div>
                    )}

                    {/* New Members section — hidden when search or game filter is active (AC-6) */}
                    {!debouncedSearch && !gameId && <NewMembersSection />}

                    {/* Search — hidden on mobile, where the toolbar search replaces it */}
                    <div className="relative hidden md:block">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search players..."
                            className="w-full pl-10 pr-4 py-2.5 bg-panel border border-edge rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                        />
                    </div>

                    {/* Player Grid */}
                    {isLoading ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {Array.from({ length: 10 }).map((_, i) => (
                                <div key={i} className="bg-panel border border-edge rounded-lg p-4 animate-pulse">
                                    <div className="w-16 h-16 rounded-full bg-overlay mx-auto" />
                                    <div className="h-4 w-20 bg-overlay rounded mx-auto mt-3" />
                                </div>
                            ))}
                        </div>
                    ) : players.length === 0 ? (
                        <div className="text-center py-12 text-muted">
                            <p className="text-lg">No players found</p>
                            {debouncedSearch && (
                                <p className="text-sm mt-1">Try a different search term</p>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Desktop player grid */}
                            <div className="hidden md:grid md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {players.map((player) => {
                                    const avatar = resolveAvatar(toAvatarUser(player));
                                    return (
                                        <Link
                                            key={player.id}
                                            to={`/users/${player.id}`}
                                            className="bg-panel border border-edge rounded-lg p-4 hover:bg-overlay transition-colors text-center group"
                                        >
                                            {avatar.url ? (
                                                <img
                                                    src={avatar.url}
                                                    alt={player.username}
                                                    className="w-16 h-16 rounded-full mx-auto bg-overlay object-cover"
                                                    onError={(e) => {
                                                        e.currentTarget.style.display = 'none';
                                                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                                    }}
                                                />
                                            ) : null}
                                            <div className={`w-16 h-16 rounded-full mx-auto bg-overlay flex items-center justify-center text-2xl text-muted ${avatar.url ? 'hidden' : ''}`}>
                                                {player.username.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="mt-3 text-sm font-medium text-foreground group-hover:text-emerald-400 transition-colors truncate">
                                                {player.username}
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                            {/* Mobile player grid */}
                            <div className="md:hidden grid grid-cols-2 gap-3">
                                {players.map((player) => (
                                    <MobilePlayerCard key={player.id} player={player} />
                                ))}
                            </div>
                        </>
                    )}

                    {/* Infinite Scroll Sentinel */}
                    {!isLoading && players.length > 0 && (
                        <InfiniteScrollSentinel
                            sentinelRef={sentinelRef}
                            isFetchingNextPage={isFetchingNextPage}
                            hasNextPage={hasNextPage}
                        />
                    )}
                </div>
            </div>
        </PullToRefresh>
    );
}
