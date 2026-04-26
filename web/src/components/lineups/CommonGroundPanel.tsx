/**
 * Common Ground panel — shows games owned by multiple community members (ROK-934).
 * Renders filter controls, a horizontal-scroll game grid, and handles nomination.
 *
 * State + data plumbing lives in `useCommonGroundState`; pure blend
 * helpers live in `common-ground-ai-merge.helpers.ts` (split out for
 * ROK-1107 to keep this file below the 300-line soft limit).
 */
import { type JSX, useRef, useState, useEffect, useCallback } from 'react';
import type {
    AiSuggestionDto,
    CommonGroundGameDto,
    CommonGroundResponseDto,
} from '@raid-ledger/contract';
import type { CommonGroundParams } from '../../lib/api-client';
import { CommonGroundFilters } from './CommonGroundFilters';
import { CommonGroundGameCard } from './CommonGroundGameCard';
import { useCommonGroundState } from './use-common-ground-state';
import { AiStatusBanner } from './AiStatusBanner';

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
            <h2 className="text-lg font-semibold text-white">Nominate a Game</h2>
            <span className="text-xs text-muted bg-panel border border-edge/50 rounded-full px-2.5 py-0.5">
                {nominated}/{max} nominated
            </span>
        </div>
    );
}

const ARROW_CLS = 'absolute top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-surface/90 border border-edge rounded-full flex items-center justify-center text-foreground shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-panel';

function ScrollArrow({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
    const path = direction === 'left' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7';
    return (
        <button onClick={onClick} className={`${ARROW_CLS} ${direction === 'left' ? 'left-0' : 'right-0'}`} aria-label={`Scroll ${direction}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
            </svg>
        </button>
    );
}

/** Game card grid — horizontal scroll with arrow navigation. */
function GameGrid({
    games,
    onNominate,
    nominatingId,
    atCap,
    aiSuggestionsByGameId,
}: {
    games: CommonGroundGameDto[];
    onNominate: (id: number) => void;
    nominatingId: number | null;
    atCap: boolean;
    aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
}): JSX.Element {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canLeft, setCanLeft] = useState(false);
    const [canRight, setCanRight] = useState(false);

    const check = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        setCanLeft(el.scrollLeft > 0);
        setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    }, []);

    useEffect(() => {
        check();
        const el = scrollRef.current;
        if (!el) return;
        el.addEventListener('scroll', check, { passive: true });
        return () => el.removeEventListener('scroll', check);
    }, [games, check]);

    const scroll = (dir: 'left' | 'right') => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollBy({ left: dir === 'left' ? -el.clientWidth * 0.8 : el.clientWidth * 0.8, behavior: 'smooth' });
    };

    return (
        <div className="relative group/carousel">
            {canLeft && <ScrollArrow direction="left" onClick={() => scroll('left')} />}
            <div ref={scrollRef} className="flex gap-3 overflow-x-auto overflow-y-hidden pb-2 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
                {games.map((g) => {
                    const ai = aiSuggestionsByGameId.get(g.gameId);
                    return (
                        <CommonGroundGameCard
                            key={g.gameId}
                            game={g}
                            onNominate={onNominate}
                            isNominating={nominatingId === g.gameId}
                            atCap={atCap}
                            aiSuggested={!!ai}
                            aiReasoning={ai?.reasoning}
                        />
                    );
                })}
            </div>
            {canRight && <ScrollArrow direction="right" onClick={() => scroll('right')} />}
        </div>
    );
}

/** Content area — renders filters, loading/error states, and game grid. */
function PanelContent({
    mergedData,
    filters,
    setFilters,
    availableTags,
    isLoading,
    isError,
    refetch,
    onNominate,
    nominatingId,
    atCap,
    search,
    setSearch,
    aiSuggestionsByGameId,
}: {
    mergedData: CommonGroundResponseDto | undefined;
    filters: CommonGroundParams;
    setFilters: (f: CommonGroundParams) => void;
    availableTags: string[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
    onNominate: (id: number) => void;
    nominatingId: number | null;
    atCap: boolean;
    search: string;
    setSearch: (v: string) => void;
    aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
}): JSX.Element {
    return (
        <>
            <CommonGroundFilters filters={filters} onChange={setFilters} availableTags={availableTags} search={search} onSearchChange={setSearch} />
            {isLoading && <LoadingSkeleton />}
            {isError && <ErrorState onRetry={refetch} />}
            {mergedData && mergedData.data.length === 0 && <EmptyState />}
            {mergedData && mergedData.data.length > 0 && (
                <GameGrid
                    games={mergedData.data}
                    onNominate={onNominate}
                    nominatingId={nominatingId}
                    atCap={atCap}
                    aiSuggestionsByGameId={aiSuggestionsByGameId}
                />
            )}
        </>
    );
}

/**
 * Main Common Ground panel (ROK-1065).
 * Pass `lineupId` when the parent already has it — that bypasses the
 * active-lineup lookup entirely. Without a prop we pick the newest
 * building lineup from /lineups/active (array). `canParticipate=false`
 * disables the Nominate buttons (private-lineup non-invitees).
 */
export function CommonGroundPanel({
    lineupId: propLineupId,
    canParticipate = true,
}: {
    lineupId?: number;
    canParticipate?: boolean;
} = {}): JSX.Element | null {
    const state = useCommonGroundState(propLineupId, canParticipate);
    if (!state.hasBuilding) return null;
    return (
        <section className="space-y-3">
            <PanelHeader nominated={state.rawMeta.nominatedCount} max={state.rawMeta.maxNominations} />
            <AiStatusBanner
                isLoading={state.aiIsLoading}
                isUnavailable={state.aiIsUnavailable}
                isError={state.aiIsError}
            />
            <PanelContent {...state} />
        </section>
    );
}
