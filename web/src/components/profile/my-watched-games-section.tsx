import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { UserHeartedGameDto } from '@raid-ledger/contract';
import { useAuth, getAuthToken } from '../../hooks/use-auth';
import { useUserHeartedGames } from '../../hooks/use-user-profile';
import { API_BASE_URL } from '../../lib/config';

/**
 * Card displaying a hearted game with toggle capability.
 * Based on OnboardingGameCard visual pattern but div-based (no navigation).
 */
function WatchedGameCard({
    game,
    selected,
    onToggle,
}: {
    game: UserHeartedGameDto;
    selected: boolean;
    onToggle: (gameId: number) => void;
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onToggle(game.id)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(game.id);
                }
            }}
            className={`group relative rounded-xl overflow-hidden bg-panel border-2 transition-all cursor-pointer hover:shadow-lg hover:shadow-emerald-900/20 ${
                selected
                    ? 'border-emerald-500 shadow-emerald-500/20 shadow-md'
                    : 'border-edge/50 opacity-50'
            }`}
        >
            {/* Cover Image */}
            <div className="relative aspect-[3/4] bg-overlay">
                {game.coverUrl ? (
                    <img
                        src={game.coverUrl}
                        alt={game.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-dim">
                        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                )}

                {/* Bottom gradient overlay */}
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />

                {/* Game name */}
                <div className="absolute bottom-0 left-0 right-0 p-3">
                    <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
                        {game.name}
                    </h3>
                </div>

                {/* Heart icon */}
                <div className="absolute top-1 left-1 flex items-center justify-center w-11 h-11 rounded-full bg-black/50">
                    <svg
                        className={`w-5 h-5 transition-colors ${
                            selected ? 'text-red-400 fill-red-400' : 'text-white/70'
                        }`}
                        fill={selected ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                </div>
            </div>
        </div>
    );
}

/**
 * My Watched Games section for the profile settings page (ROK-311).
 * Displays games the user has hearted with a buffered-save pattern.
 * Toggles are local until "Save Changes" is clicked.
 */
export function MyWatchedGamesSection() {
    const { user } = useAuth();
    const { data: heartedData, isLoading } = useUserHeartedGames(user?.id);
    const queryClient = useQueryClient();

    const serverGames = useMemo(() => heartedData?.data ?? [], [heartedData]);
    const serverIds = useMemo(() => new Set(serverGames.map((g) => g.id)), [serverGames]);

    // Local state tracks which game IDs are currently selected
    const [localIds, setLocalIds] = useState<Set<number> | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Effective selection: local overrides server when user has made changes
    const effectiveIds = localIds ?? serverIds;

    // Detect dirty state
    const isDirty = useMemo(() => {
        if (!localIds) return false;
        if (localIds.size !== serverIds.size) return true;
        for (const id of localIds) {
            if (!serverIds.has(id)) return true;
        }
        return false;
    }, [localIds, serverIds]);

    const handleToggle = useCallback((gameId: number) => {
        setLocalIds((prev) => {
            const current = prev ?? new Set(serverIds);
            const next = new Set(current);
            if (next.has(gameId)) {
                next.delete(gameId);
            } else {
                next.add(gameId);
            }
            return next;
        });
    }, [serverIds]);

    const handleReset = useCallback(() => {
        setLocalIds(null);
    }, []);

    const handleSave = useCallback(async () => {
        if (!isDirty || isSaving) return;

        // Find games that were removed (in server but not in local)
        const removedIds = [...serverIds].filter((id) => !effectiveIds.has(id));

        setIsSaving(true);
        try {
            const headers = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getAuthToken() || ''}`,
            };

            // Fire DELETE for each unselected game
            await Promise.all(
                removedIds.map(async (gameId) => {
                    const res = await fetch(`${API_BASE_URL}/games/${gameId}/want-to-play`, {
                        method: 'DELETE',
                        headers,
                    });
                    if (!res.ok) throw new Error(`Failed to remove game ${gameId} (${res.status})`);
                }),
            );

            // Invalidate relevant queries
            queryClient.invalidateQueries({ queryKey: ['userHeartedGames'] });
            queryClient.invalidateQueries({ queryKey: ['games', 'interest'] });
            queryClient.invalidateQueries({ queryKey: ['games', 'discover'] });

            // Reset local state so it syncs with server
            setLocalIds(null);
        } finally {
            setIsSaving(false);
        }
    }, [isDirty, isSaving, serverIds, effectiveIds, queryClient]);

    if (isLoading) {
        return (
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">My Watched Games</h2>
                <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
                </div>
            </div>
        );
    }

    if (serverGames.length === 0) {
        return (
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">My Watched Games</h2>
                <div className="text-center py-8">
                    <svg className="w-12 h-12 mx-auto mb-3 text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    <p className="text-muted mb-3">You haven't hearted any games yet.</p>
                    <Link
                        to="/games"
                        className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                    >
                        Browse the game library
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-foreground">My Watched Games</h2>
                {isDirty && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleReset}
                            className="text-sm text-muted hover:text-foreground transition-colors"
                        >
                            Reset
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-medium rounded-lg transition-colors text-sm"
                        >
                            {isSaving ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                'Save Changes'
                            )}
                        </button>
                    </div>
                )}
            </div>

            <p className="text-sm text-muted mb-5">
                Click a game to toggle your interest. Changes are saved when you click "Save Changes".
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {serverGames.map((game) => (
                    <WatchedGameCard
                        key={game.id}
                        game={game}
                        selected={effectiveIds.has(game.id)}
                        onToggle={handleToggle}
                    />
                ))}
            </div>
        </div>
    );
}
