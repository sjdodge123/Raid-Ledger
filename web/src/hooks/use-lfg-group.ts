/**
 * ROK-1464 — read hooks for the LFG group page.
 *
 * Query-key namespace is shared with the LFG hub (ROK-1453): everything under
 * the `['lfg', …]` prefix, so a single `invalidateQueries({ queryKey: ['lfg'] })`
 * after a write refreshes both surfaces. The slug lookup lives under
 * `['games', 'slug', …]` because it resolves a game, not an LFG group.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
    GameSlugLookupDto,
    LfgGroupDetailDto,
    LfgHistoryResponseDto,
    LfgOverlapResponseDto,
    LfgSuggestionsResponseDto,
} from '@raid-ledger/contract';
import {
    getGameBySlug,
    getGroup,
    getHistory,
    getOverlap,
    getSuggestions,
} from '../lib/api-client';

/** Resolve `/lfg/:gameSlug` to a numeric game id. Rejects on an unknown slug. */
export function useGameBySlug(
    slug: string | undefined,
): UseQueryResult<GameSlugLookupDto> {
    return useQuery({
        queryKey: ['games', 'slug', slug],
        queryFn: () => getGameBySlug(slug as string),
        enabled: Boolean(slug),
        // A slug never changes meaning mid-session; re-resolving it on every
        // focus would issue a lookup per panel refresh for nothing.
        staleTime: 1000 * 60 * 10,
        retry: false,
    });
}

/** The derived group: counts, roster and the caller's own intent. */
export function useLfgGroup(
    gameId: number | undefined,
): UseQueryResult<LfgGroupDetailDto> {
    return useQuery({
        queryKey: ['lfg', 'group', gameId],
        queryFn: () => getGroup(gameId as number),
        enabled: Boolean(gameId),
    });
}

/** Windows the live roster could all play in. */
export function useLfgOverlap(
    gameId: number | undefined,
): UseQueryResult<LfgOverlapResponseDto> {
    return useQuery({
        queryKey: ['lfg', 'overlap', gameId],
        queryFn: () => getOverlap(gameId as number),
        enabled: Boolean(gameId),
    });
}

/** Past scheduled events and Quick Play sessions for the game. */
export function useLfgHistory(
    gameId: number | undefined,
): UseQueryResult<LfgHistoryResponseDto> {
    return useQuery({
        queryKey: ['lfg', 'history', gameId],
        queryFn: () => getHistory(gameId as number),
        enabled: Boolean(gameId),
    });
}

/** Players who might want in on this group. */
export function useLfgSuggestions(
    gameId: number | undefined,
): UseQueryResult<LfgSuggestionsResponseDto> {
    return useQuery({
        queryKey: ['lfg', 'suggestions', gameId],
        queryFn: () => getSuggestions(gameId as number),
        enabled: Boolean(gameId),
    });
}
