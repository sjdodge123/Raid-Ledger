import { useState, useEffect } from 'react';
import { toast } from '../../lib/toast';
import { useAdminGames } from '../../hooks/use-admin-games';

export function GameLibraryTable() {
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);

    // 300ms debounce on search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const { games, deleteGame } = useAdminGames(debouncedSearch, page);
    const data = games.data;

    const handleDelete = async (gameId: number, gameName: string) => {
        if (!confirm(`Remove "${gameName}" from the game library? This cannot be undone.`)) {
            return;
        }

        try {
            const result = await deleteGame.mutateAsync(gameId);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete game');
        }
    };

    return (
        <div className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">Manage Library</h2>

            {/* Search */}
            <div className="mb-4">
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search games..."
                    className="w-full px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                />
            </div>

            {/* Loading state */}
            {games.isLoading && (
                <div className="text-center py-8 text-muted">Loading games...</div>
            )}

            {/* Empty state */}
            {!games.isLoading && data && data.data.length === 0 && (
                <div className="text-center py-8 text-muted">
                    {debouncedSearch ? 'No games match your search.' : 'No games in library yet. Run a sync to populate.'}
                </div>
            )}

            {/* Game List */}
            {data && data.data.length > 0 && (
                <>
                    {/* Mobile Card Layout (<768px) */}
                    <div className="md:hidden space-y-2">
                        {data.data.map((game) => (
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
                                    <div className="text-foreground font-medium truncate">{game.name}</div>
                                    <div className="text-xs text-muted mt-0.5">IGDB ID: {game.igdbId}</div>
                                    <div className="text-xs text-muted">Cached: {new Date(game.cachedAt).toLocaleDateString()}</div>
                                </div>
                                <button
                                    onClick={() => handleDelete(game.id, game.name)}
                                    disabled={deleteGame.isPending}
                                    className="w-11 h-11 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50 rounded-lg transition-colors flex-shrink-0"
                                    title="Remove game"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
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
                                    <th className="px-4 py-3 text-muted font-medium w-16"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.data.map((game) => (
                                    <tr key={game.id} className="border-b border-edge/30 last:border-0 hover:bg-overlay/20 transition-colors">
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
                                                <span className="text-foreground font-medium truncate">{game.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-muted">{game.igdbId}</td>
                                        <td className="px-4 py-3 text-muted">
                                            {new Date(game.cachedAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => handleDelete(game.id, game.name)}
                                                disabled={deleteGame.isPending}
                                                className="text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                                                title="Remove game"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {data.meta.totalPages > 1 && (
                        <div className="flex items-center justify-between mt-4 text-sm">
                            <span className="text-muted">
                                {data.meta.total} games · Page {data.meta.page} of {data.meta.totalPages}
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                    className="px-3 py-2.5 min-h-[44px] bg-overlay hover:bg-faint disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-foreground transition-colors"
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => setPage((p) => Math.min(data.meta.totalPages, p + 1))}
                                    disabled={page >= data.meta.totalPages}
                                    className="px-3 py-2.5 min-h-[44px] bg-overlay hover:bg-faint disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-foreground transition-colors"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
