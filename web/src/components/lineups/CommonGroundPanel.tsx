/**
 * Common Ground panel — shows games owned by multiple community members (ROK-934).
 * Renders filter controls, a horizontal-scroll game grid, and handles nomination.
 */
import { type JSX, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import type {
    AiSuggestionDto,
    CommonGroundGameDto,
    CommonGroundResponseDto,
} from '@raid-ledger/contract';
import type { CommonGroundParams } from '../../lib/api-client';
import { useActiveLineups, useCommonGround, useNominateGame } from '../../hooks/use-lineups';
import { useAiSuggestions } from '../../hooks/use-ai-suggestions';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
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

/**
 * Promote an AI suggestion that Common Ground didn't return into the
 * same grid by mapping the AI DTO's enriched metadata into a
 * CommonGroundGameDto. `ownerCount` comes from the community-wide
 * count (matches Common Ground's badge), not voter-scoped ownership.
 * Synthetic `score` derives from LLM confidence so the merge sort
 * interleaves AI-only picks naturally with Common Ground picks rather
 * than front-loading them.
 */
function aiOnlyStub(s: AiSuggestionDto): CommonGroundGameDto {
    return {
        gameId: s.gameId,
        gameName: s.name,
        slug: s.slug,
        coverUrl: s.coverUrl,
        ownerCount: s.communityOwnerCount,
        wishlistCount: s.wishlistCount,
        nonOwnerPrice: s.nonOwnerPrice,
        itadCurrentCut: s.itadCurrentCut,
        itadCurrentShop: s.itadCurrentShop,
        itadCurrentUrl: s.itadCurrentUrl,
        earlyAccess: s.earlyAccess,
        itadTags: s.itadTags,
        playerCount: s.playerCount,
        score: s.confidence * 100,
    };
}

/**
 * Mirror the Common Ground query's filter semantics on the frontend for
 * AI-only stubs. Keeps the grid consistent when the operator narrows
 * by owners / players / genre / search — AI cards that don't match the
 * filter vanish alongside the Common Ground rows that also fail.
 */
function aiStubMatchesFilters(
    stub: CommonGroundGameDto,
    filters: CommonGroundParams,
    search: string,
): boolean {
    if (filters.minOwners != null && stub.ownerCount < filters.minOwners) return false;
    if (filters.maxPlayers != null && stub.playerCount) {
        const { min, max } = stub.playerCount;
        if (!(min <= filters.maxPlayers && max >= filters.maxPlayers)) return false;
    }
    if (filters.maxPlayers != null && !stub.playerCount) return false;
    if (filters.genre && !stub.itadTags.includes(filters.genre)) return false;
    const q = search.trim().toLowerCase();
    if (q && !stub.gameName.toLowerCase().includes(q)) return false;
    return true;
}

/**
 * Merge AI-suggested games into the Common Ground response. Games
 * already in the response get the badge via `aiSuggestionsByGameId` at
 * render time; games that the LLM suggested but Common Ground didn't
 * return get synthesised as stubs (with community-wide ownership +
 * confidence-derived score), filtered by the active Common Ground
 * filters, and then sorted alongside the CG rows by `score` so AI
 * picks land naturally in the mix rather than all at the front.
 */
function mergeAiIntoCommonGround(
    data: CommonGroundResponseDto | undefined,
    aiMap: Map<number, AiSuggestionDto>,
    filters: CommonGroundParams,
    search: string,
): CommonGroundResponseDto | undefined {
    if (!data) return data;
    if (aiMap.size === 0) return data;
    const present = new Set(data.data.map((g) => g.gameId));
    const aiOnly: CommonGroundGameDto[] = [];
    for (const [gameId, ai] of aiMap) {
        if (present.has(gameId)) continue;
        const stub = aiOnlyStub(ai);
        if (aiStubMatchesFilters(stub, filters, search)) aiOnly.push(stub);
    }
    if (aiOnly.length === 0) return data;
    const merged = [...data.data, ...aiOnly].sort((a, b) => b.score - a.score);
    return { ...data, data: merged };
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

/** Hook for nomination state management. */
function useNomination(lineupId: number | undefined) {
    const [nominatingId, setNominatingId] = useState<number | null>(null);
    const nominate = useNominateGame();

    const handleNominate = useCallback(
        (gameId: number) => {
            if (!lineupId) return;
            setNominatingId(gameId);
            nominate.mutate(
                { lineupId, body: { gameId } },
                { onSettled: () => setNominatingId(null) },
            );
        },
        [lineupId, nominate],
    );

    return { nominatingId, handleNominate };
}

/** Content area — renders filters, loading/error states, and game grid. */
function PanelContent({
    data,
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
    onSearchChange,
    aiSuggestionsByGameId,
}: {
    data: CommonGroundResponseDto | undefined;
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
    onSearchChange: (v: string) => void;
    aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
}): JSX.Element {
    return (
        <>
            <CommonGroundFilters filters={filters} onChange={setFilters} availableTags={availableTags} search={search} onSearchChange={onSearchChange} />
            {isLoading && <LoadingSkeleton />}
            {isError && <ErrorState onRetry={refetch} />}
            {data && data.data.length === 0 && <EmptyState />}
            {data && data.data.length > 0 && (
                <GameGrid
                    games={data.data}
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
    const { data: activeLineups } = useActiveLineups();
    const newestBuilding = activeLineups?.find((l) => l.status === 'building') ?? null;
    const resolvedId = propLineupId ?? newestBuilding?.id;
    const [filters, setFilters] = useState<CommonGroundParams>({ minOwners: 0 });
    const [search, setSearch] = useState('');
    const hasBuilding = propLineupId != null || !!newestBuilding;
    const apiParams = useMemo(
        () => ({
            ...filters,
            search: search.trim() || undefined,
            lineupId: resolvedId,
        }),
        [filters, search, resolvedId],
    );
    const debouncedParams = useDebouncedValue(apiParams, 300);
    const { data, isLoading, isError, refetch } = useCommonGround(debouncedParams, hasBuilding);
    const availableTags = useMemo(() => (data?.data ? extractUniqueTags(data.data) : []), [data]);
    const rawAtCap = (data?.meta.nominatedCount ?? 0) >= (data?.meta.maxNominations ?? 20);
    const atCap = rawAtCap || !canParticipate;
    const { nominatingId, handleNominate } = useNomination(resolvedId);

    // ROK-931: fetch AI suggestions alongside Common Ground and blend them
    // into the same grid. `aiSuggestionsByGameId` drives the ✨ AI badge +
    // tooltip reasoning on matching cards; AI-only games (not owned by
    // anyone yet) are synthesised as stub CommonGroundGameDto entries.
    const aiQuery = useAiSuggestions(resolvedId, { enabled: hasBuilding });
    const aiSuggestionsByGameId = useMemo(() => {
        const map = new Map<number, AiSuggestionDto>();
        if (aiQuery.data?.kind === 'ok') {
            for (const s of aiQuery.data.data.suggestions) map.set(s.gameId, s);
        }
        return map;
    }, [aiQuery.data]);

    const mergedData = useMemo(
        () => mergeAiIntoCommonGround(data, aiSuggestionsByGameId, filters, search),
        [data, aiSuggestionsByGameId, filters, search],
    );

    if (!hasBuilding) return null;

    return (
        <section className="space-y-3">
            <PanelHeader nominated={data?.meta.nominatedCount ?? 0} max={data?.meta.maxNominations ?? 20} />
            <PanelContent
                data={mergedData} filters={filters} setFilters={setFilters} availableTags={availableTags}
                isLoading={isLoading} isError={isError} refetch={() => void refetch()}
                onNominate={handleNominate} nominatingId={nominatingId} atCap={atCap}
                search={search} onSearchChange={setSearch}
                aiSuggestionsByGameId={aiSuggestionsByGameId}
            />
        </section>
    );
}
