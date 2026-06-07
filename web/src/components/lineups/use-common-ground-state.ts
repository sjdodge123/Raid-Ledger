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
import { useAiSuggestionsAvailable } from '../../hooks/use-ai-suggestions-available';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { mergeAiIntoCommonGround } from './common-ground-ai-merge.helpers';

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
    /**
     * Voting-eligibility size for the active lineup (ROK-1255). 0 when
     * unknown / not yet loaded — consumers should fall back to default
     * behavior. Drives the auto-set player-count filter on first mount.
     */
    participantCount: number;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
    onNominate: (gameId: number) => void;
    nominatingId: number | null;
    /**
     * True only when the lineup has reached its NOMINATION cap (ROK-1349).
     * No longer conflated with the view-only permission state — see
     * `viewOnly`.
     */
    atCap: boolean;
    /**
     * True when the viewer cannot participate (private-lineup non-invitee).
     * Drives the "View only" button copy, separate from `atCap` so the two
     * disabled reasons render distinct labels (ROK-1349).
     */
    viewOnly: boolean;
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

    const mergedData = useMemo(
        () => mergeAiIntoCommonGround(data, aiSuggestionsByGameId, filters, search),
        [data, aiSuggestionsByGameId, filters, search],
    );

    const atCap =
        (data?.meta.nominatedCount ?? 0) >= (data?.meta.maxNominations ?? 20);
    // ROK-1349: view-only is a permission state, kept distinct from atCap so
    // non-invitees get an "ask the creator for an invite" label instead of
    // the misleading "Lineup full" the conflated flag produced.
    const viewOnly = !canParticipate;

    const rawMeta = useMemo(
        () => ({
            nominatedCount: data?.meta.nominatedCount ?? 0,
            maxNominations: data?.meta.maxNominations ?? 20,
        }),
        [data],
    );
    const participantCount = data?.meta.participantCount ?? 0;

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

    // When the AI feature is disabled (plugin off or admin toggle off),
    // collapse all AI status flags so CommonGroundPanel never renders
    // the AI status banner. The grid still renders normally.
    const aiIsUnavailable = aiAvailable && aiQuery.data?.kind === 'unavailable';
    const aiIsLoading = aiAvailable && hasBuilding && aiQuery.isLoading;
    const aiIsError = aiAvailable && aiQuery.isError && !aiIsUnavailable;

    return {
        hasBuilding,
        mergedData,
        rawMeta,
        filters,
        setFilters,
        search,
        setSearch,
        participantCount,
        isLoading,
        isError,
        refetch: stableRefetch,
        onNominate,
        nominatingId,
        atCap,
        viewOnly,
        aiSuggestionsByGameId,
        aiIsLoading,
        aiIsUnavailable,
        aiIsError,
    };
}
