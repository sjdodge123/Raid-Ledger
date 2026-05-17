import { useQuery } from '@tanstack/react-query';
import type { GameDetailDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

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
        queryFn: async () => {
            const token = getAuthToken();
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const response = await fetch(`${API_BASE_URL}/games/lookup-by-name`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ q: name }),
            });
            if (!response.ok) throw new Error(`Lookup failed (${response.status})`);
            return response.json();
        },
        enabled: enabled && !!name && name.trim().length > 0,
        staleTime: 1000 * 60 * 5,
        retry: false,
    });
}
