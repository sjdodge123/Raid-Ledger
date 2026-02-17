import { useState, useEffect } from 'react';
import { toast } from '../../lib/toast';
import { useAdminGames } from '../../hooks/use-admin-games';

export function GameLibraryTable() {
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);
    const [showHidden, setShowHidden] = useState<'only' | undefined>(undefined);

    // 300ms debounce on search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const { games, deleteGame, hideGame, unhideGame } = useAdminGames(debouncedSearch, page, 20, showHidden);
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

            {/* Search + Filter */}
            <div className="mb-4 flex flex-col sm:flex-row gap-3">
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search games..."
                    className="flex-1 px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                />
                <label className="flex items-center gap-2 px-3 py-2 bg-surface/30 border border-edge/50 rounded-lg cursor-pointer hover:bg-surface/50 transition-colors select-none">
                    <input
                        type="checkbox"
                        checked={showHidden === 'only'}
                        onChange={(e) => {
                            setShowHidden(e.target.checked ? 'only' : undefined);
                            setPage(1);
                        }}
                        className="w-4 h-4 rounded border-edge text-purple-500 focus:ring-purple-500 bg-surface/50"
                    />
                    <span className="text-sm text-secondary whitespace-nowrap">Show hidden</span>
                </label>
            </div>

            {/* Loading state */}
            {games.isLoading && (
                <div className="text-center py-8 text-muted">Loading games...</div>
            )}

            {/* Empty state */}
            {!games.isLoading && data && data.data.length === 0 && (
                <div className="text-center py-8 text-muted">
                    {showHidden === 'only'
                        ? 'No hidden games.'
                        : debouncedSearch
                            ? 'No games match your search.'
                            : 'No games in library yet. Run a sync to populate.'}
                </div>
            )}

            {/* Table */}
            {data && data.data.length > 0 && (
                <>
                    <div className="bg-panel/50 rounded-xl border border-edge/50 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-edge/50">
                                    <th className="text-left px-4 py-3 text-muted font-medium">Game</th>
                                    <th className="text-left px-4 py-3 text-muted font-medium hidden sm:table-cell">IGDB ID</th>
                                    <th className="text-left px-4 py-3 text-muted font-medium hidden md:table-cell">Cached</th>
                                    <th className="px-4 py-3 text-muted font-medium w-24"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.data.map((game) => (
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
                                                    {game.hidden && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded flex-shrink-0">
                                                            Hidden
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-muted hidden sm:table-cell">{game.igdbId}</td>
                                        <td className="px-4 py-3 text-muted hidden md:table-cell">
                                            {new Date(game.cachedAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {game.hidden ? (
                                                    <button
                                                        onClick={() => handleUnhide(game.id)}
                                                        disabled={unhideGame.isPending}
                                                        className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
                                                        title="Unhide game"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                        </svg>
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleHide(game.id)}
                                                        disabled={hideGame.isPending}
                                                        className="text-yellow-400 hover:text-yellow-300 disabled:opacity-50 transition-colors"
                                                        title="Hide game from users"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                        </svg>
                                                    </button>
                                                )}
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
                                            </div>
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
                                    className="px-3 py-1.5 bg-overlay hover:bg-faint disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-foreground transition-colors"
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => setPage((p) => Math.min(data.meta.totalPages, p + 1))}
                                    disabled={page >= data.meta.totalPages}
                                    className="px-3 py-1.5 bg-overlay hover:bg-faint disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-foreground transition-colors"
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
