/**
 * Common Ground panel — shows games owned by multiple community members (ROK-934).
 * Renders filter controls, a horizontal-scroll game grid, and handles nomination.
 */
import { type JSX, useState, useMemo, useCallback } from 'react';
import type { CommonGroundParams } from '../../lib/api-client';
import { useActiveLineup } from '../../hooks/use-lineups';
import { useCommonGround, useNominateGame } from '../../hooks/use-lineups';
import { CommonGroundFilters } from './CommonGroundFilters';
import { CommonGroundGameCard } from './CommonGroundGameCard';

/** Extract unique ITAD tags from the response for the genre filter dropdown. */
function extractUniqueTags(data: { itadTags: string[] }[]): string[] {
    const set = new Set<string>();
    for (const g of data) {
        for (const t of g.itadTags) set.add(t);
    }
    return [...set].sort();
}

/** Loading skeleton cards. */
function LoadingSkeleton(): JSX.Element {
    return (
        <div className="flex gap-3 overflow-x-auto pb-2">
            {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="w-[180px] flex-shrink-0 rounded-xl bg-panel border border-edge/50 animate-pulse">
                    <div className="aspect-[3/4] bg-zinc-800/50 rounded-t-xl" />
                </div>
            ))}
        </div>
    );
}

/** Empty state when no games match filters. */
function EmptyState(): JSX.Element {
    return (
        <p className="text-sm text-muted py-8 text-center">
            No games match your filters. Try lowering the minimum owners.
        </p>
    );
}

/** Error state with retry. */
function ErrorState({ onRetry }: { onRetry: () => void }): JSX.Element {
    return (
        <div className="text-center py-8">
            <p className="text-sm text-muted mb-2">Failed to load Common Ground. Try again.</p>
            <button
                onClick={onRetry}
                className="px-3 py-1 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
            >
                Retry
            </button>
        </div>
    );
}

/** Header with title and nomination count. */
function PanelHeader({ nominated, max }: { nominated: number; max: number }): JSX.Element {
    return (
        <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">Common Ground</h2>
            <span className="text-xs text-muted bg-panel border border-edge/50 rounded-full px-2.5 py-0.5">
                {nominated}/{max} nominated
            </span>
        </div>
    );
}

/** Game card grid — horizontal scroll. */
function GameGrid({
    games,
    onNominate,
    nominatingId,
    atCap,
}: {
    games: { gameId: number }[];
    onNominate: (id: number) => void;
    nominatingId: number | null;
    atCap: boolean;
}): JSX.Element {
    // Safe cast — we know these are CommonGroundGameDto
    const items = games as import('@raid-ledger/contract').CommonGroundGameDto[];
    return (
        <div className="flex gap-3 overflow-x-auto pb-2">
            {items.map((g) => (
                <CommonGroundGameCard
                    key={g.gameId}
                    game={g}
                    onNominate={onNominate}
                    isNominating={nominatingId === g.gameId}
                    atCap={atCap}
                />
            ))}
        </div>
    );
}

/** Main Common Ground panel. */
export function CommonGroundPanel(): JSX.Element | null {
    const { data: lineup } = useActiveLineup();
    const [filters, setFilters] = useState<CommonGroundParams>({ minOwners: 2 });
    const [nominatingId, setNominatingId] = useState<number | null>(null);

    const hasBuilding = lineup?.status === 'building';
    const { data, isLoading, isError, refetch } = useCommonGround(filters, hasBuilding);
    const nominate = useNominateGame();

    const availableTags = useMemo(
        () => (data?.data ? extractUniqueTags(data.data) : []),
        [data],
    );

    const atCap = (data?.meta.nominatedCount ?? 0) >= (data?.meta.maxNominations ?? 20);

    const handleNominate = useCallback(
        (gameId: number) => {
            if (!lineup) return;
            setNominatingId(gameId);
            nominate.mutate(
                { lineupId: lineup.id, body: { gameId } },
                { onSettled: () => setNominatingId(null) },
            );
        },
        [lineup, nominate],
    );

    if (!hasBuilding) return null;

    return (
        <section className="space-y-3">
            <PanelHeader
                nominated={data?.meta.nominatedCount ?? 0}
                max={data?.meta.maxNominations ?? 20}
            />
            <CommonGroundFilters
                filters={filters}
                onChange={setFilters}
                availableTags={availableTags}
            />
            {isLoading && <LoadingSkeleton />}
            {isError && <ErrorState onRetry={() => void refetch()} />}
            {data && data.data.length === 0 && <EmptyState />}
            {data && data.data.length > 0 && (
                <GameGrid
                    games={data.data}
                    onNominate={handleNominate}
                    nominatingId={nominatingId}
                    atCap={atCap}
                />
            )}
        </section>
    );
}
