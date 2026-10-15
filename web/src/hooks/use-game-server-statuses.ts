/** Live game-server statuses for one game (ROK-1776). The server polls every 2 min, so 60s is plenty. */
import { useQuery } from '@tanstack/react-query';
import { fetchGameServerStatuses } from '../lib/api/game-servers-api';

export function gameServerStatusesKey(gameId: number | undefined) {
    return ['game-servers', 'status', gameId] as const;
}

/**
 * `enabled` is the caller's gate (an active provider plugin); the query also stays
 * idle without a real game id.
 */
export function useGameServerStatuses(gameId: number | undefined, enabled: boolean) {
    const id = gameId ?? 0;
    return useQuery({
        queryKey: gameServerStatusesKey(gameId),
        queryFn: () => fetchGameServerStatuses([id]),
        enabled: enabled && id > 0,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });
}
