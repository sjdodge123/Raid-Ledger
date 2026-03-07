import { useState, useEffect } from 'react';
import { toast } from '../../lib/toast';
import { useAdminGames } from '../../hooks/use-admin-games';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { InfiniteScrollSentinel } from '../ui/infinite-scroll-sentinel';
import { GameActionButtons } from './GameLibraryActions';

interface GameLibraryTableProps {
    showHidden?: 'only' | undefined;
}

interface GameItem {
    id: number; name: string; igdbId: number; coverUrl: string | null;
    cachedAt: string; banned: boolean; hidden: boolean;
}

function GameStatusBadge({ game }: { game: GameItem }) {
    if (game.banned) return <span className="text-xs px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded flex-shrink-0">Banned</span>;
    if (game.hidden) return <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded flex-shrink-0">Hidden</span>;
    return null;
}

function GameCover({ url, size }: { url: string | null; size: 'sm' | 'md' }) {
    const cls = size === 'sm' ? 'w-8 h-10' : 'w-12 h-16';
    if (url) return <img src={url} alt="" className={`${cls} rounded object-cover flex-shrink-0`} />;
    return <div className={`${cls} rounded bg-overlay flex-shrink-0`} />;
}

function MobileGameCard({ game, actions }: { game: GameItem; actions: React.ReactNode }) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-3 flex items-center gap-3">
            <GameCover url={game.coverUrl} size="md" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <div className="text-foreground font-medium truncate">{game.name}</div>
                    <GameStatusBadge game={game} />
                </div>
                <div className="text-xs text-muted mt-0.5">IGDB ID: {game.igdbId}</div>
                <div className="text-xs text-muted">Cached: {new Date(game.cachedAt).toLocaleDateString()}</div>
            </div>
            <div className="flex-shrink-0">{actions}</div>
        </div>
    );
}

function DesktopGameRow({ game, actions }: { game: GameItem; actions: React.ReactNode }) {
    return (
        <tr className={`border-b border-edge/30 last:border-0 hover:bg-overlay/20 transition-colors ${game.hidden ? 'opacity-60' : ''}`}>
            <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                    <GameCover url={game.coverUrl} size="sm" />
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-foreground font-medium truncate">{game.name}</span>
                        <GameStatusBadge game={game} />
                    </div>
                </div>
            </td>
            <td className="px-4 py-3 text-muted">{game.igdbId}</td>
            <td className="px-4 py-3 text-muted">{new Date(game.cachedAt).toLocaleDateString()}</td>
            <td className="px-4 py-3 text-right">{actions}</td>
        </tr>
    );
}

function useGameHandlers(debouncedSearch: string, showHidden: 'only' | undefined) {
    const { games, banGame, unbanGame, hideGame, unhideGame } = useAdminGames(debouncedSearch, 20, showHidden);

    const handleDelete = async (gameId: number, gameName: string) => {
        if (!confirm(`Ban "${gameName}" from the game library? You can unban it later from the hidden games view.`)) return;
        try { const r = await banGame.mutateAsync(gameId); toast[r.success ? 'success' : 'error'](r.message); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to delete game'); }
    };

    const handleUnban = async (gameId: number) => {
        try { const r = await unbanGame.mutateAsync(gameId); toast[r.success ? 'success' : 'error'](r.message); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to unban game'); }
    };

    const handleHide = async (gameId: number) => {
        try { const r = await hideGame.mutateAsync(gameId); toast[r.success ? 'success' : 'error'](r.message); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to hide game'); }
    };

    const handleUnhide = async (gameId: number) => {
        try { const r = await unhideGame.mutateAsync(gameId); toast[r.success ? 'success' : 'error'](r.message); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to unhide game'); }
    };

    return { games, banGame, unbanGame, hideGame, unhideGame, handleDelete, handleUnban, handleHide, handleUnhide };
}

function emptyMessage(showHidden: 'only' | undefined, hasSearch: boolean) {
    if (showHidden === 'only') return 'No hidden games.';
    if (hasSearch) return 'No games match your search.';
    return 'No games in library yet. Run a sync to populate.';
}

function GameTableHeader() {
    return (
        <thead>
            <tr className="border-b border-edge/50">
                <th className="text-left px-4 py-3 text-muted font-medium">Game</th>
                <th className="text-left px-4 py-3 text-muted font-medium">IGDB ID</th>
                <th className="text-left px-4 py-3 text-muted font-medium">Cached</th>
                <th className="px-4 py-3 text-muted font-medium w-24"></th>
            </tr>
        </thead>
    );
}

function buildActionProps(h: ReturnType<typeof useGameHandlers>) {
    return {
        onBan: h.handleDelete, onUnban: h.handleUnban, onHide: h.handleHide, onUnhide: h.handleUnhide,
        isBanning: h.banGame.isPending, isUnbanning: h.unbanGame.isPending,
        isHiding: h.hideGame.isPending, isUnhiding: h.unhideGame.isPending,
    };
}

function GameListContent({ items, total, actionProps, sentinelRef, isFetchingNextPage, hasNextPage }: {
    items: GameItem[]; total: number; actionProps: ReturnType<typeof buildActionProps>;
    sentinelRef: React.RefObject<HTMLDivElement | null>; isFetchingNextPage: boolean; hasNextPage: boolean;
}) {
    return (
        <>
            <div className="text-sm text-muted mb-2">{total} games</div>
            <div className="md:hidden space-y-2">
                {items.map((game) => <MobileGameCard key={game.id} game={game} actions={<GameActionButtons game={game} {...actionProps} />} />)}
            </div>
            <div className="hidden md:block bg-panel/50 rounded-xl border border-edge/50 overflow-hidden">
                <table className="w-full text-sm">
                    <GameTableHeader />
                    <tbody>
                        {items.map((game) => <DesktopGameRow key={game.id} game={game} actions={<GameActionButtons game={game} {...actionProps} size="sm" />} />)}
                    </tbody>
                </table>
            </div>
            <InfiniteScrollSentinel sentinelRef={sentinelRef} isFetchingNextPage={isFetchingNextPage} hasNextPage={hasNextPage} />
        </>
    );
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

    const h = useGameHandlers(debouncedSearch, showHidden);
    const { items, isLoading, total, isFetchingNextPage, hasNextPage, sentinelRef } = h.games;

    return (
        <div className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-4">Manage Library</h2>
            <div className="sticky md:top-0 z-10 bg-surface/95 backdrop-blur-sm pb-4 -mx-1 px-1"
                style={{ top: isHeaderHidden ? 75 : 140, transition: 'top 300ms ease-in-out' }}>
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search games..."
                    className="w-full px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all" />
            </div>
            {isLoading && <div className="text-center py-8 text-muted">Loading games...</div>}
            {!isLoading && items.length === 0 && <div className="text-center py-8 text-muted">{emptyMessage(showHidden, !!debouncedSearch)}</div>}
            {items.length > 0 && <GameListContent items={items} total={total} actionProps={buildActionProps(h)}
                sentinelRef={sentinelRef} isFetchingNextPage={isFetchingNextPage} hasNextPage={hasNextPage} />}
        </div>
    );
}
