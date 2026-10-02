/**
 * Sub-hooks behind `useCommonGroundState` (ROK-1107), one per concern so
 * each stays small:
 *
 * - `useResolvedLineupId` — the prop lineup, else the newest building one.
 * - `usePersistedCommonGroundFilters` — per-lineup, session-persisted
 *   filters + search (ROK-1400), with allow-list sanitizers.
 * - `useCommonGroundQuery` — the co-op latch, effective filters, debounced
 *   API params and the Common Ground query. Kept in one hook because the
 *   latch is promoted during render from the query's own response.
 * - `useCommonGroundAi` — AI suggestions map + status flags (ROK-931).
 * - `useGridNomination` — nomination mutation state.
 * - `useCommonGroundMeta` — nomination cap + participant meta.
 */
import { useCallback, useMemo, useState } from 'react';
import type {
    AiSuggestionDto,
    CommonGroundResponseDto,
} from '@raid-ledger/contract';
import type { CommonGroundParams } from '../../lib/api-client';
import {
    useActiveLineups,
    useCommonGround,
    useNominateGame,
} from '../../hooks/use-lineups';
import { useAiSuggestions } from '../../hooks/use-ai-suggestions';
import { useAiSuggestionsAvailable } from '../../hooks/use-ai-suggestions-available';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useSessionState } from '../../hooks/use-session-state';

/** sessionStorage key prefixes for the per-lineup persisted panel state. */
const FILTERS_KEY_PREFIX = 'common-ground:filters:';
const SEARCH_KEY_PREFIX = 'common-ground:search:';
const DEFAULT_FILTERS: CommonGroundParams = { minOwners: 0 };

/** Whole non-negative integer, for the numeric filter fields. */
function asCount(raw: unknown, min: number): number | undefined {
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= min
        ? raw
        : undefined;
}

/**
 * Allow-list sanitizer for persisted filters (ROK-1400 review). Stored JSON
 * is untrusted — hand-editable, and shape-drifted blobs outlive deploys. Only
 * known keys with the right type survive; anything else is dropped rather
 * than handed to consumers that assume the shape (e.g. `search.trim()`).
 * Returns null only when the blob isn't a plain object at all, which evicts
 * the entry entirely.
 */
function sanitizeFilters(raw: unknown): CommonGroundParams | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return null;
    }
    const r = raw as Record<string, unknown>;
    const clean: CommonGroundParams = {};
    const minOwners = asCount(r.minOwners, 0);
    if (minOwners !== undefined) clean.minOwners = minOwners;
    const maxPlayers = asCount(r.maxPlayers, 1);
    if (maxPlayers !== undefined) clean.maxPlayers = maxPlayers;
    const minOnlineCoop = asCount(r.minOnlineCoop, 1);
    if (minOnlineCoop !== undefined) clean.minOnlineCoop = minOnlineCoop;
    if (typeof r.genre === 'string') clean.genre = r.genre;
    return clean;
}

/** Persisted search must be a string — `search.trim()` runs on it. */
function sanitizeSearch(raw: unknown): string | null {
    return typeof raw === 'string' ? raw : null;
}

/** The prop lineup when given, else the newest building lineup. */
export function useResolvedLineupId(propLineupId: number | undefined) {
    const { data: activeLineups } = useActiveLineups();
    const newestBuilding =
        activeLineups?.find((l) => l.status === 'building') ?? null;
    const resolvedId = propLineupId ?? newestBuilding?.id;
    const hasBuilding = propLineupId != null || !!newestBuilding;
    return { resolvedId, hasBuilding };
}

export function usePersistedCommonGroundFilters(
    resolvedId: number | undefined,
) {
    // ROK-1400 (operator review 2026-08-20): the whole filter set — search,
    // min owners, players, co-op toggle + size — survives navigating away
    // and back, keyed per lineup so two lineups don't share a view. Session-
    // scoped: a fresh browser session starts clean.
    const {
        value: filters,
        setValue: setFilters,
        restored: filtersRestored,
    } = useSessionState<CommonGroundParams>(
        resolvedId != null ? `${FILTERS_KEY_PREFIX}${resolvedId}` : null,
        DEFAULT_FILTERS,
        sanitizeFilters,
    );
    const { value: search, setValue: setSearch } = useSessionState<string>(
        resolvedId != null ? `${SEARCH_KEY_PREFIX}${resolvedId}` : null,
        '',
        sanitizeSearch,
    );
    return { filters, setFilters, filtersRestored, search, setSearch };
}

/** `filters` minus `minOnlineCoop` while the co-op control is dormant. */
function withoutDormantCoop(
    filters: CommonGroundParams,
    coopDataAvailable: boolean,
): CommonGroundParams {
    const { minOnlineCoop, ...withoutCoop } = filters;
    if (coopDataAvailable || minOnlineCoop == null) return filters;
    return withoutCoop;
}

/** Request params: effective filters + trimmed search + lineup. */
function toApiParams(
    effectiveFilters: CommonGroundParams,
    search: string,
    resolvedId: number | undefined,
): CommonGroundParams {
    return {
        ...effectiveFilters,
        search: search.trim() || undefined,
        lineupId: resolvedId,
    };
}

export function useCommonGroundQuery(
    filters: CommonGroundParams,
    search: string,
    resolvedId: number | undefined,
    hasBuilding: boolean,
) {
    // ROK-1400: latched from `meta.coopDataAvailable` once the first response
    // lands. Latched (never flips back) so an in-flight refetch can't make the
    // co-op control blink out from under the user.
    const [coopDataAvailable, setCoopDataAvailable] = useState(false);

    // Defensive (operator, round 2): the co-op control is dormant until the
    // catalogue has Co-Optimus data, but filters persisted from an earlier
    // visit can still carry `minOnlineCoop`. Never send it while the control
    // is hidden — a filter the user can neither see nor clear must not
    // silently empty the grid.
    const effectiveFilters = useMemo(
        () => withoutDormantCoop(filters, coopDataAvailable),
        [filters, coopDataAvailable],
    );
    const apiParams = useMemo(
        () => toApiParams(effectiveFilters, search, resolvedId),
        [effectiveFilters, search, resolvedId],
    );
    const debouncedParams = useDebouncedValue(apiParams, 300);
    const query = useCommonGround(debouncedParams, hasBuilding);
    const { data, refetch } = query;
    // Adjust-state-during-render (React docs pattern): promote the flag as
    // soon as the response carries it, without a cascading-render effect.
    if (data?.meta.coopDataAvailable === true && !coopDataAvailable)
        setCoopDataAvailable(true);
    const stableRefetch = useCallback(() => void refetch(), [refetch]);
    return {
        data,
        isLoading: query.isLoading,
        isError: query.isError,
        refetch: stableRefetch,
        coopDataAvailable,
        effectiveFilters,
    };
}

type AiQueryState = Pick<
    ReturnType<typeof useAiSuggestions>,
    'data' | 'isLoading' | 'isError' | 'pollExhausted'
>;

/** AI status flags for the panel banner/skeleton (pure). */
export function deriveAiFlags(
    aiAvailable: boolean,
    hasBuilding: boolean,
    aiQuery: AiQueryState,
) {
    // When the AI feature is disabled (plugin off or admin toggle off),
    // collapse all AI status flags so CommonGroundPanel never renders
    // the AI status banner. The grid still renders normally.
    const aiIsUnavailable = aiAvailable && aiQuery.data?.kind === 'unavailable';
    // ROK-1316: a cold-cache read returns `pending: true` while the
    // background pre-gen job warms; treat it as loading so the existing
    // skeleton/loading state renders until the real payload arrives.
    // Rework #3: once polling exhausts its cap and the payload is STILL
    // pending (pre-gen never finished), stop showing the skeleton — fall
    // back to the empty state instead of an infinite spinner.
    const aiIsPending =
        aiQuery.data?.kind === 'ok' &&
        aiQuery.data.data.pending === true &&
        !aiQuery.pollExhausted;
    const aiIsLoading =
        aiAvailable && hasBuilding && (aiQuery.isLoading || aiIsPending);
    const aiIsError = aiAvailable && aiQuery.isError && !aiIsUnavailable;
    return { aiIsLoading, aiIsUnavailable, aiIsError };
}

export function useCommonGroundAi(
    resolvedId: number | undefined,
    hasBuilding: boolean,
) {
    // ROK-931: fetch AI suggestions alongside Common Ground and blend
    // them into the same grid. The map drives the ✨ AI badge + tooltip
    // reasoning on matching cards; AI-only games (not owned yet) are
    // synthesised as stub CommonGroundGameDto entries.
    //
    // ROK-1114 round 3: gate the entire AI side on the combined
    // plugin+admin-toggle hook. When the AI surface is off, never fire
    // the request and never seed the badge map — the grid keeps
    // rendering, just without the ✨ AI overlay.
    const aiAvailable = useAiSuggestionsAvailable();
    const aiQuery = useAiSuggestions(resolvedId, {
        enabled: hasBuilding && aiAvailable,
    });
    const aiSuggestionsByGameId = useMemo(() => {
        const map = new Map<number, AiSuggestionDto>();
        if (!aiAvailable) return map;
        if (aiQuery.data?.kind === 'ok') {
            for (const s of aiQuery.data.data.suggestions) map.set(s.gameId, s);
        }
        return map;
    }, [aiAvailable, aiQuery.data]);
    return {
        aiSuggestionsByGameId,
        ...deriveAiFlags(aiAvailable, hasBuilding, aiQuery),
    };
}

export function useGridNomination(resolvedId: number | undefined) {
    const [nominatingId, setNominatingId] = useState<number | null>(null);
    const nominate = useNominateGame();
    const onNominate = useCallback(
        (gameId: number) => {
            if (!resolvedId) return;
            setNominatingId(gameId);
            nominate.mutate(
                { lineupId: resolvedId, body: { gameId } },
                { onSettled: () => setNominatingId(null) },
            );
        },
        [resolvedId, nominate],
    );
    return { nominatingId, onNominate };
}

export function useCommonGroundMeta(data: CommonGroundResponseDto | undefined) {
    const rawMeta = useMemo(
        () => ({
            nominatedCount: data?.meta.nominatedCount ?? 0,
            maxNominations: data?.meta.maxNominations ?? 20,
        }),
        [data],
    );
    const atCap =
        (data?.meta.nominatedCount ?? 0) >= (data?.meta.maxNominations ?? 20);
    const participantCount = data?.meta.participantCount ?? 0;
    return { rawMeta, atCap, participantCount };
}
