import { useState, useEffect } from 'react';
import { toast } from '../../lib/toast';
import { useAdminGames } from '../../hooks/use-admin-games';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { InfiniteScrollSentinel } from '../ui/infinite-scroll-sentinel';
import { GameActionButtons } from './GameLibraryActions';

interface GameLibraryTableProps {
    showHidden?: 'only' | undefined;
}

export function GameLibraryTable({ showHidden }: GameLibraryTableProps) {
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const scrollDirection = useScrollDirection();
    const isHeaderHidden = scrollDirection === 'down';

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const { games, banGame, unbanGame, hideGame, unhideGame } = useAdminGames(debouncedSearch, 20, showHidden);
    const { items, isLoading, total, isFetchingNextPage, hasNextPage, sentinelRef } = games;

    const handleDelete = async (gameId: number, gameName: string) => {
        if (!confirm(`Ban "${gameName}" from the game library? You can unban it later from the hidden games view.`)) return;
        try {
            const result = await banGame.mutateAsync(gameId);
            toast[result.success ? 'success' : 'error'](result.message);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete game');
        }
    };

    const handleUnban = async (gameId: number) => {
        try { const result = await unbanGame.mutateAsync(gameId); toast[result.success ? 'success' : 'error'](result.message); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to unban game'); }
    };

    const handleHide = async (gameId: number) => {
        try { const result = await hideGame.mutateAsync(gameId); toast[result.success ? 'success' : 'error'](result.message); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to hide game'); }
    };

    const handleUnhide = async (gameId: number) => {
        try { const result = await unhideGame.mutateAsync(gameId); toast[result.success ? 'success' : 'error'](result.message); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to unhide game'); }
    };

    return (
        <div className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">Manage Library</h2>

            <div className="sticky md:top-0 z-10 bg-surface/95 backdrop-blur-sm pb-4 -mx-1 px-1"
                style={{ top: isHeaderHidden ? 75 : 140, transition: 'top 300ms ease-in-out' }}>
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search games..."
                    className="w-full px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all" />
            </div>

            {isLoading && <div className="text-center py-8 text-muted">Loading games...</div>}

            {!isLoading && items.length === 0 && (
                <div className="text-center py-8 text-muted">
                    {showHidden === 'only' ? 'No hidden games.' : debouncedSearch ? 'No games match your search.' : 'No games in library yet. Run a sync to populate.'}
                </div>
            )}

            {items.length > 0 && (
                <>
                    <div className="text-sm text-muted mb-2">{total} games</div>

                    {/* Mobile Card Layout */}
                    <div className="md:hidden space-y-2">
                        {items.map((game) => (
                            <div key={game.id} className="bg-panel/50 rounded-xl border border-edge/50 p-3 flex items-center gap-3">
                                {game.coverUrl ? (
                                    <img src={game.coverUrl} alt="" className="w-12 h-16 rounded object-cover flex-shrink-0" />
                                ) : (
                                    <div className="w-12 h-16 rounded bg-overlay flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div className="text-foreground font-medium truncate">{game.name}</div>
                                        {game.banned && <span className="text-xs px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded flex-shrink-0">Banned</span>}
                                        {game.hidden && !game.banned && <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded flex-shrink-0">Hidden</span>}
                                    </div>
                                    <div className="text-xs text-muted mt-0.5">IGDB ID: {game.igdbId}</div>
                                    <div className="text-xs text-muted">Cached: {new Date(game.cachedAt).toLocaleDateString()}</div>
                                </div>
                                <div className="flex-shrink-0">
                                    <GameActionButtons game={game} onBan={handleDelete} onUnban={handleUnban}
                                        onHide={handleHide} onUnhide={handleUnhide}
                                        isBanning={banGame.isPending} isUnbanning={unbanGame.isPending}
                                        isHiding={hideGame.isPending} isUnhiding={unhideGame.isPending} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Desktop Table Layout */}
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
                                                    <img src={game.coverUrl} alt="" className="w-8 h-10 rounded object-cover flex-shrink-0" />
                                                ) : (
                                                    <div className="w-8 h-10 rounded bg-overlay flex-shrink-0" />
                                                )}
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-foreground font-medium truncate">{game.name}</span>
                                                    {game.banned && <span className="text-xs px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded flex-shrink-0">Banned</span>}
                                                    {game.hidden && !game.banned && <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded flex-shrink-0">Hidden</span>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-muted">{game.igdbId}</td>
                                        <td className="px-4 py-3 text-muted">{new Date(game.cachedAt).toLocaleDateString()}</td>
                                        <td className="px-4 py-3 text-right">
                                            <GameActionButtons game={game} onBan={handleDelete} onUnban={handleUnban}
                                                onHide={handleHide} onUnhide={handleUnhide} size="sm"
                                                isBanning={banGame.isPending} isUnbanning={unbanGame.isPending}
                                                isHiding={hideGame.isPending} isUnhiding={unhideGame.isPending} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <InfiniteScrollSentinel sentinelRef={sentinelRef} isFetchingNextPage={isFetchingNextPage} hasNextPage={hasNextPage} />
                </>
            )}
        </div>
    );
}
