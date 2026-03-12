import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { UserHeartedGameDto } from '@raid-ledger/contract';
import { useAuth, getAuthToken } from '../../hooks/use-auth';
import { useUserHeartedGames } from '../../hooks/use-user-profile';
import { API_BASE_URL } from '../../lib/config';
import { UnifiedGameCard } from '../games/unified-game-card';

/**
 * My Watched Games section for the profile settings page (ROK-311).
 * Displays games the user has hearted with a buffered-save pattern.
 * Toggles are local until "Save Changes" is clicked.
 */
function WatchedGamesLoading() {
    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">
                My Watched Games
            </h2>
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
            </div>
        </div>
    );
}

function WatchedGamesEmpty() {
    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">
                My Watched Games
            </h2>
            <div className="text-center py-8">
                <svg
                    className="w-12 h-12 mx-auto mb-3 text-dim"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                    />
                </svg>
                <p className="text-muted mb-3">
                    You haven't hearted any games yet.
                </p>
                <Link
                    to="/games"
                    className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                >
                    Browse the game library
                    <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                        />
                    </svg>
                </Link>
            </div>
        </div>
    );
}

function SaveBar({
    isDirty,
    isSaving,
    onReset,
    onSave,
}: {
    isDirty: boolean;
    isSaving: boolean;
    onReset: () => void;
    onSave: () => void;
}) {
    if (!isDirty) return null;
    return (
        <div className="flex items-center gap-3">
            <button
                onClick={onReset}
                className="text-sm text-muted hover:text-foreground transition-colors"
            >
                Reset
            </button>
            <button
                onClick={onSave}
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
    );
}

async function removeUnheartedGames(removedIds: number[]) {
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    };
    await Promise.all(
        removedIds.map(async (gameId) => {
            const res = await fetch(
                `${API_BASE_URL}/games/${gameId}/want-to-play`,
                { method: 'DELETE', headers },
            );
            if (!res.ok)
                throw new Error(`Failed to remove game ${gameId} (${res.status})`);
        }),
    );
}

function useWatchedGamesDirty(
    localIds: Set<number> | null,
    serverIds: Set<number>,
) {
    return useMemo(() => {
        if (!localIds) return false;
        if (localIds.size !== serverIds.size) return true;
        for (const id of localIds) {
            if (!serverIds.has(id)) return true;
        }
        return false;
    }, [localIds, serverIds]);
}

function useWatchedGamesState() {
    const { user } = useAuth();
    const { data: heartedData, isLoading } = useUserHeartedGames(user?.id);
    const queryClient = useQueryClient();
    const serverGames = useMemo(
        () => heartedData?.data ?? [],
        [heartedData],
    );
    const serverIds = useMemo(
        () => new Set(serverGames.map((g) => g.id)),
        [serverGames],
    );
    const [localIds, setLocalIds] = useState<Set<number> | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const effectiveIds = localIds ?? serverIds;
    const isDirty = useWatchedGamesDirty(localIds, serverIds);
    const handleToggle = useCallback(
        (gameId: number) => {
            setLocalIds((prev) => {
                const next = new Set(prev ?? new Set(serverIds));
                if (next.has(gameId)) next.delete(gameId);
                else next.add(gameId);
                return next;
            });
        },
        [serverIds],
    );
    const handleSave = useCallback(async () => {
        if (!isDirty || isSaving) return;
        setIsSaving(true);
        try {
            await removeUnheartedGames(
                [...serverIds].filter((id) => !effectiveIds.has(id)),
            );
            queryClient.invalidateQueries({
                queryKey: ['userHeartedGames'],
            });
            queryClient.invalidateQueries({
                queryKey: ['games', 'interest'],
            });
            queryClient.invalidateQueries({
                queryKey: ['games', 'discover'],
            });
            setLocalIds(null);
        } finally {
            setIsSaving(false);
        }
    }, [isDirty, isSaving, serverIds, effectiveIds, queryClient]);

    return {
        serverGames,
        isLoading,
        effectiveIds,
        isDirty,
        isSaving,
        handleToggle,
        handleReset: useCallback(() => setLocalIds(null), []),
        handleSave,
    };
}

/** Render a single watched game card with toggle behavior. */
function WatchedGameItem({
    game,
    selected,
    onToggle,
}: {
    game: UserHeartedGameDto;
    selected: boolean;
    onToggle: (gameId: number) => void;
}) {
    return (
        <UnifiedGameCard
            variant="toggle"
            game={game}
            selected={selected}
            onToggle={() => onToggle(game.id)}
            dimWhenInactive
        />
    );
}

export function MyWatchedGamesSection() {
    const s = useWatchedGamesState();

    if (s.isLoading) return <WatchedGamesLoading />;
    if (s.serverGames.length === 0) return <WatchedGamesEmpty />;

    return (
        <div className="bg-surface border border-edge-subtle rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-foreground">
                    My Watched Games
                </h2>
                <SaveBar
                    isDirty={s.isDirty}
                    isSaving={s.isSaving}
                    onReset={s.handleReset}
                    onSave={s.handleSave}
                />
            </div>
            <p className="text-sm text-muted mb-5">
                Click a game to toggle your interest. Changes are saved when you
                click "Save Changes".
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {s.serverGames.map((game) => (
                    <WatchedGameItem
                        key={game.id}
                        game={game}
                        selected={s.effectiveIds.has(game.id)}
                        onToggle={s.handleToggle}
                    />
                ))}
            </div>
        </div>
    );
}
