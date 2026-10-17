/**
 * State + data plumbing for the Common Ground panel (ROK-1107).
 *
 * Composes the sub-hooks in `use-common-ground-sub-hooks.ts`:
 * - Resolving the active building lineup when no prop `lineupId`.
 * - Session-persisted filters, search, and debounced API params.
 * - Common Ground + AI-suggestions queries.
 * - The `aiSuggestionsByGameId` map that drives the ✨ AI badge.
 * - Nomination mutation state (`nominatingId`, `onNominate`).
 *
 * Blends AI-only picks into the Common Ground grid itself.
 *
 * Extracted from `CommonGroundPanel.tsx` to keep the panel file below
 * the 300-line soft limit.
 */
import { useMemo } from 'react';
import type {
    AiSuggestionDto,
    CommonGroundResponseDto,
} from '@raid-ledger/contract';
import type { CommonGroundParams } from '../../lib/api-client';
import { mergeAiIntoCommonGround } from './common-ground-ai-merge.helpers';
import {
    useCommonGroundAi,
    useCommonGroundMeta,
    useCommonGroundQuery,
    useGridNomination,
    usePersistedCommonGroundFilters,
    useResolvedLineupId,
} from './use-common-ground-sub-hooks';

export interface UseCommonGroundStateResult {
    hasBuilding: boolean;
    mergedData: CommonGroundResponseDto | undefined;
    rawMeta: {
        nominatedCount: number;
        maxNominations: number;
    };
    filters: CommonGroundParams;
    setFilters: (f: CommonGroundParams) => void;
    /**
     * True when `filters` came back from sessionStorage (ROK-1400). Callers
     * pass this to `CommonGroundFilters.suppressAutoSeed` so the ROK-1255
     * one-shot maxPlayers seed doesn't overwrite a restored "Any" choice on
     * every remount.
     */
    filtersRestored: boolean;
    /**
     * ROK-1400: whether the catalogue has any Co-Optimus-synced game
     * (`meta.coopDataAvailable`, latched). Callers pass it to
     * `CommonGroundFilters.coopDataAvailable`; while false the co-op control
     * is not rendered AND any persisted `minOnlineCoop` is withheld from the
     * request.
     */
    coopDataAvailable: boolean;
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
    const { resolvedId, hasBuilding } = useResolvedLineupId(propLineupId);
    const persisted = usePersistedCommonGroundFilters(resolvedId);
    const { filters, search } = persisted;
    const grid = useCommonGroundQuery(filters, search, resolvedId, hasBuilding);
    const { data, effectiveFilters, ...queryState } = grid;
    const ai = useCommonGroundAi(resolvedId, hasBuilding);
    const aiMap = ai.aiSuggestionsByGameId;
    const mergedData = useMemo(
        // Effective (not raw) filters: the AI-stub mirror must agree with what
        // the server was actually asked for, or a dormant co-op filter would
        // drop stubs the query itself never filtered on (ROK-1400).
        () => mergeAiIntoCommonGround(data, aiMap, effectiveFilters, search),
        [data, aiMap, effectiveFilters, search],
    );
    const nomination = useGridNomination(resolvedId);
    const meta = useCommonGroundMeta(data);
    return {
        hasBuilding,
        mergedData,
        ...persisted,
        ...queryState,
        ...nomination,
        ...meta,
        // ROK-1349: view-only is a permission state, kept distinct from atCap
        // so non-invitees get an "ask the creator for an invite" label instead
        // of the misleading "Lineup full" the conflated flag produced.
        viewOnly: !canParticipate,
        ...ai,
    };
}
