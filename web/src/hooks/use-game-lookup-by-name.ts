import { useQuery } from '@tanstack/react-query';
import type { GameDetailDto } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';

/**
 * ROK-1295 — POST /games/lookup-by-name.
 * Triggered when <GameRef /> is rendered with a name but no gameId.
 * Disabled until the drawer opens (`enabled` gate) so we don't lookup
 * games the user hasn't expressed intent for.
 */
export function useGameLookupByName(name: string | undefined, enabled: boolean) {
    const normalizedKey = name?.trim().toLowerCase() ?? '';
    return useQuery<GameDetailDto>({
        queryKey: ['games', 'lookup-by-name', normalizedKey],
        queryFn: () =>
            fetchApi<GameDetailDto>('/games/lookup-by-name', {
                method: 'POST',
                body: JSON.stringify({ q: name }),
            }),
        enabled: enabled && !!name && name.trim().length > 0,
        staleTime: 1000 * 60 * 5,
        retry: false,
    });
}
