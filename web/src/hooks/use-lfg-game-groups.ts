/**
 * ROK-2352 — `GET /lfg/:gameId/groups?include=catalogue`, under the shared
 * `['lfg', …]` prefix so every LFG write's invalidation refreshes it.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LfgGroupListResponseDto } from '@raid-ledger/contract';
import { getLfgGameGroups } from '../lib/api/lfg-group-api';

/**
 * The game's groups (`''` first). Only enabled when a grouping is active —
 * a non-grouped game never issues the request.
 */
export function useLfgGameGroups(
    gameId: number | undefined,
    enabled: boolean,
): UseQueryResult<LfgGroupListResponseDto> {
    return useQuery({
        queryKey: ['lfg', 'game-groups', gameId],
        queryFn: () => getLfgGameGroups(gameId as number, true),
        enabled: enabled && Boolean(gameId),
        staleTime: 1000 * 60,
    });
}
