import { useState, useEffect } from 'react';
import { toast } from '../../lib/toast';
import { useAdminGames } from '../../hooks/use-admin-games';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { InfiniteScrollSentinel } from '../ui/infinite-scroll-sentinel';

interface GameLibraryTableProps {
    showHidden?: 'only' | undefined;
}

export function GameLibraryTable({ showHidden }: GameLibraryTableProps) {
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const scrollDirection = useScrollDirection();
    const isHeaderHidden = scrollDirection === 'down';

    // 300ms debounce on search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const { games, banGame, unbanGame, hideGame, unhideGame } = useAdminGames(debouncedSearch, 20, showHidden);
    const { items, isLoading, total, isFetchingNextPage, hasNextPage, sentinelRef } = games;

    const handleDelete = async (gameId: number, gameName: string) => {
        if (!confirm(`Ban "${gameName}" from the game library? You can unban it later from the hidden games view.`)) {
            return;
        }

        try {
            const result = await banGame.mutateAsync(gameId);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete game');
        }
    };

    const handleUnban = async (gameId: number) => {
        try {
            const result = await unbanGame.mutateAsync(gameId);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to unban game');
        }
    };

    const handleHide = async (gameId: number) => {
        try {
            const result = await hideGame.mutateAsync(gameId);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to hide game');
        }
    };

    const handleUnhide = async (gameId: number) => {
        try {
            const result = await unhideGame.mutateAsync(gameId);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to unhide game');
        }
    };

    return (
        <div className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">Manage Library</h2>

            {/* Search */}
            <div
                className="sticky md:top-0 z-10 bg-surface/95 backdrop-blur-sm pb-4 -mx-1 px-1"
                style={{
                    top: isHeaderHidden ? 75 : 140,
                    transition: 'top 300ms ease-in-out',
                }}
            >
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search games..."
                    className="w-full px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                />
            </div>

            {/* Loading state */}
            {isLoading && (
                <div className="text-center py-8 text-muted">Loading games...</div>
            )}

            {/* Empty state */}
            {!isLoading && items.length === 0 && (
                <div className="text-center py-8 text-muted">
                    {showHidden === 'only'
                        ? 'No hidden games.'
                        : debouncedSearch
                            ? 'No games match your search.'
                            : 'No games in library yet. Run a sync to populate.'}
                </div>
            )}

            {/* Game List */}
            {items.length > 0 && (
                <>
                    <div className="text-sm text-muted mb-2">{total} games</div>

                    {/* Mobile Card Layout (<768px) */}
                    <div className="md:hidden space-y-2">
                        {items.map((game) => (
                            <div key={game.id} className="bg-panel/50 rounded-xl border border-edge/50 p-3 flex items-center gap-3">
                                {game.coverUrl ? (
                                    <img
                                        src={game.coverUrl}
                                        alt=""
                                        className="w-12 h-16 rounded object-cover flex-shrink-0"
                                    />
                                ) : (
                                    <div className="w-12 h-16 rounded bg-overlay flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div className="text-foreground font-medium truncate">{game.name}</div>
                                        {game.banned && (
                                            <span className="text-xs px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded flex-shrink-0">
                                                Banned
                                            </span>
                                        )}
                                        {game.hidden && !game.banned && (
                                            <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded flex-shrink-0">
                                                Hidden
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-muted mt-0.5">IGDB ID: {game.igdbId}</div>
                                    <div className="text-xs text-muted">Cached: {new Date(game.cachedAt).toLocaleDateString()}</div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    {game.banned ? (
                                        <button
                                            onClick={() => handleUnban(game.id)}
                                            disabled={unbanGame.isPending}
                                            className="w-11 h-11 flex items-center justify-center text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 rounded-lg transition-colors"
                                            title="Unban game"
                                            aria-label="Unban game"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                        </button>
                                    ) : game.hidden ? (
                                        <button
                                            onClick={() => handleUnhide(game.id)}
                                            disabled={unhideGame.isPending}
                                            className="w-11 h-11 flex items-center justify-center text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 rounded-lg transition-colors"
                                            title="Unhide game"
                                            aria-label="Unhide game"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            </svg>
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleHide(game.id)}
                                            disabled={hideGame.isPending}
                                            className="w-11 h-11 flex items-center justify-center text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50 rounded-lg transition-colors"
                                            title="Hide game from users"
                                            aria-label="Hide game from users"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                            </svg>
                                        </button>
                                    )}
                                    {!game.banned && (
                                        <button
                                            onClick={() => handleDelete(game.id, game.name)}
                                            disabled={banGame.isPending}
                                            className="w-11 h-11 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50 rounded-lg transition-colors"
                                            title="Remove game"
                                            aria-label="Remove game"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Desktop Table Layout (>=768px) */}
                    <div className="hidden md:block bg-panel/50 rounded-xl border border-edge/50 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-edge/50">
                                    <th className="text-left px-4 py-3 text-muted font-medium">Game</th>
                                    <th className="text-left px-4 py-3 text-muted font-medium">IGDB ID</th>
                                    <th className="text-left px-4 py-3 text-muted font-medium">Cached</th>
                                    <th className="px-4 py-3 text-muted font-medium w-24"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((game) => (
                                    <tr key={game.id} className={`border-b border-edge/30 last:border-0 hover:bg-overlay/20 transition-colors ${game.hidden ? 'opacity-60' : ''}`}>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                {game.coverUrl ? (
                                                    <img
                                                        src={game.coverUrl}
                                                        alt=""
                                                        className="w-8 h-10 rounded object-cover flex-shrink-0"
                                                    />
                                                ) : (
                                                    <div className="w-8 h-10 rounded bg-overlay flex-shrink-0" />
                                                )}
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-foreground font-medium truncate">{game.name}</span>
                                                    {game.banned && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded flex-shrink-0">
                                                            Banned
                                                        </span>
                                                    )}
                                                    {game.hidden && !game.banned && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded flex-shrink-0">
                                                            Hidden
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-muted">{game.igdbId}</td>
                                        <td className="px-4 py-3 text-muted">
                                            {new Date(game.cachedAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {game.banned ? (
                                                    <button
                                                        onClick={() => handleUnban(game.id)}
                                                        disabled={unbanGame.isPending}
                                                        className="w-11 h-11 md:w-auto md:h-auto md:p-1.5 flex items-center justify-center rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                                                        title="Unban game"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                        </svg>
                                                    </button>
                                                ) : game.hidden ? (
                                                    <button
                                                        onClick={() => handleUnhide(game.id)}
                                                        disabled={unhideGame.isPending}
                                                        className="w-11 h-11 md:w-auto md:h-auto md:p-1.5 flex items-center justify-center rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
                                                        title="Unhide game"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                        </svg>
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleHide(game.id)}
                                                        disabled={hideGame.isPending}
                                                        className="w-11 h-11 md:w-auto md:h-auto md:p-1.5 flex items-center justify-center rounded-md text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50 transition-colors"
                                                        title="Hide game from users"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                        </svg>
                                                    </button>
                                                )}
                                                {!game.banned && (
                                                    <button
                                                        onClick={() => handleDelete(game.id, game.name)}
                                                        disabled={banGame.isPending}
                                                        className="w-11 h-11 md:w-auto md:h-auto md:p-1.5 flex items-center justify-center rounded-md text-red-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                                                        title="Remove game"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Infinite Scroll Sentinel */}
                    <InfiniteScrollSentinel
                        sentinelRef={sentinelRef}
                        isFetchingNextPage={isFetchingNextPage}
                        hasNextPage={hasNextPage}
                    />
                </>
            )}
        </div>
    );
}
