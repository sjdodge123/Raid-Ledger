/**
 * State + data plumbing for the Common Ground panel (ROK-1107).
 *
 * Owns:
 * - Resolving the active building lineup when no prop `lineupId`.
 * - Filters, search, and debounced API params.
 * - Common Ground + AI-suggestions queries.
 * - The `aiSuggestionsByGameId` map that drives the ✨ AI badge.
 * - Blending AI-only picks into the Common Ground grid.
 * - Nomination mutation state (`nominatingId`, `onNominate`).
 *
 * Extracted from `CommonGroundPanel.tsx` to keep the panel file below
 * the 300-line soft limit.
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
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { mergeAiIntoCommonGround } from './common-ground-ai-merge.helpers';

/** Extract unique ITAD tags from the response for the genre filter dropdown. */
function extractUniqueTags(data: { itadTags: string[] }[]): string[] {
    const set = new Set<string>();
    for (const g of data) {
        for (const t of g.itadTags) set.add(t);
    }
    return [...set].sort();
}

export interface UseCommonGroundStateResult {
    hasBuilding: boolean;
    mergedData: CommonGroundResponseDto | undefined;
    rawMeta: {
        nominatedCount: number;
        maxNominations: number;
    };
    filters: CommonGroundParams;
    setFilters: (f: CommonGroundParams) => void;
    search: string;
    setSearch: (v: string) => void;
    availableTags: string[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
    onNominate: (gameId: number) => void;
    nominatingId: number | null;
    atCap: boolean;
    aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
    /** AI suggestions query is in flight (and the panel actually has a lineup). */
    aiIsLoading: boolean;
    /** AI endpoint returned 503 (no provider configured) — see ROK-1114. */
    aiIsUnavailable: boolean;
    /** AI suggestions query errored for any other reason. */
    aiIsError: boolean;
}

export function useCommonGroundState(
    propLineupId: number | undefined,
    canParticipate: boolean,
): UseCommonGroundStateResult {
    const { data: activeLineups } = useActiveLineups();
    const newestBuilding =
        activeLineups?.find((l) => l.status === 'building') ?? null;
    const resolvedId = propLineupId ?? newestBuilding?.id;
    const hasBuilding = propLineupId != null || !!newestBuilding;

    const [filters, setFilters] = useState<CommonGroundParams>({ minOwners: 0 });
    const [search, setSearch] = useState('');

    const apiParams = useMemo(
        () => ({
            ...filters,
            search: search.trim() || undefined,
            lineupId: resolvedId,
        }),
        [filters, search, resolvedId],
    );
    const debouncedParams = useDebouncedValue(apiParams, 300);
    const { data, isLoading, isError, refetch } = useCommonGround(
        debouncedParams,
        hasBuilding,
    );
    const availableTags = useMemo(
        () => (data?.data ? extractUniqueTags(data.data) : []),
        [data],
    );

    // ROK-931: fetch AI suggestions alongside Common Ground and blend
    // them into the same grid. The map drives the ✨ AI badge + tooltip
    // reasoning on matching cards; AI-only games (not owned yet) are
    // synthesised as stub CommonGroundGameDto entries.
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

    const rawAtCap =
        (data?.meta.nominatedCount ?? 0) >= (data?.meta.maxNominations ?? 20);
    const atCap = rawAtCap || !canParticipate;

    const rawMeta = useMemo(
        () => ({
            nominatedCount: data?.meta.nominatedCount ?? 0,
            maxNominations: data?.meta.maxNominations ?? 20,
        }),
        [data],
    );

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

    const stableRefetch = useCallback(() => void refetch(), [refetch]);

    const aiIsUnavailable = aiQuery.data?.kind === 'unavailable';
    const aiIsLoading = hasBuilding && aiQuery.isLoading;
    const aiIsError = aiQuery.isError && !aiIsUnavailable;

    return {
        hasBuilding,
        mergedData,
        rawMeta,
        filters,
        setFilters,
        search,
        setSearch,
        availableTags,
        isLoading,
        isError,
        refetch: stableRefetch,
        onNominate,
        nominatingId,
        atCap,
        aiSuggestionsByGameId,
        aiIsLoading,
        aiIsUnavailable,
        aiIsError,
    };
}
