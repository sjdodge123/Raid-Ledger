/**
 * ROK-1464 — the group page's own reads (ROK-1463 endpoints) plus the slug
 * lookup that turns `/lfg/:gameSlug` into an id.
 *
 * Query-key namespace is shared with the LFG hub (ROK-1453): everything under
 * the `['lfg', …]` prefix, so a single `invalidateQueries({ queryKey: ['lfg'] })`
 * after a write refreshes both surfaces. The slug lookup lives under
 * `['games', 'slug', …]` because it resolves a game, not an LFG group.
 *
 * D8 dedupe: the group read itself is `useLfgGroupDetail` in
 * `use-lfg-groups.ts` (ROK-1453 landed first and already owns the
 * `['lfg','group',id]` key) — do NOT add a second one here.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
    GameSlugLookupDto,
    LfgHistoryResponseDto,
    LfgOverlapResponseDto,
    LfgSuggestionsResponseDto,
} from '@raid-ledger/contract';
import {
    getGameBySlug,
    getLfgHistory,
    getLfgOverlap,
    getLfgSuggestions,
} from '../lib/api/lfg-api';

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

/** Windows the live roster could all play in. */
export function useLfgOverlap(
    gameId: number | undefined,
): UseQueryResult<LfgOverlapResponseDto> {
    return useQuery({
        queryKey: ['lfg', 'overlap', gameId],
        queryFn: () => getLfgOverlap(gameId as number),
        enabled: Boolean(gameId),
    });
}

/** Past scheduled events and Quick Play sessions for the game. */
export function useLfgHistory(
    gameId: number | undefined,
): UseQueryResult<LfgHistoryResponseDto> {
    return useQuery({
        queryKey: ['lfg', 'history', gameId],
        queryFn: () => getLfgHistory(gameId as number),
        enabled: Boolean(gameId),
    });
}

/** Players who might want in on this group. */
export function useLfgSuggestions(
    gameId: number | undefined,
): UseQueryResult<LfgSuggestionsResponseDto> {
    return useQuery({
        queryKey: ['lfg', 'suggestions', gameId],
        queryFn: () => getLfgSuggestions(gameId as number),
        enabled: Boolean(gameId),
    });
}
