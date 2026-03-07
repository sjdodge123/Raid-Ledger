import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';
import { useInfiniteList } from './use-infinite-list';

interface AdminGame {
    id: number;
    igdbId: number;
    name: string;
    slug: string;
    coverUrl: string | null;
    cachedAt: string;
    hidden: boolean;
    banned: boolean;
}

interface AdminGameListResponse {
    data: AdminGame[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasMore: boolean;
    };
}

function getHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    };
}

async function gameAction(gameId: number, action: string, fallbackMsg: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_BASE_URL}/admin/settings/games/${gameId}/${action}`, {
        method: 'POST',
        headers: getHeaders(),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: fallbackMsg }));
        throw new Error(error.message || fallbackMsg);
    }
    return response.json();
}

function useAdminGamesList(search: string, limit: number, showHidden?: 'only' | 'true') {
    return useInfiniteList<AdminGame>({
        queryKey: ['admin', 'games', { search, limit, showHidden }],
        queryFn: async (page): Promise<AdminGameListResponse> => {
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (showHidden) params.set('showHidden', showHidden);
            params.set('page', String(page));
            params.set('limit', String(limit));
            const response = await fetch(`${API_BASE_URL}/admin/settings/games?${params}`, { headers: getHeaders() });
            if (!response.ok) throw new Error('Failed to fetch games');
            return response.json();
        },
        enabled: !!getAuthToken(),
    });
}

function useAdminGameMutations() {
    const queryClient = useQueryClient();
    const invalidateGames = () => queryClient.invalidateQueries({ queryKey: ['admin', 'games'] });

    const banGame = useMutation({
        mutationFn: (gameId: number) => gameAction(gameId, 'ban', 'Failed to ban game'),
        onSuccess: () => { invalidateGames(); queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb', 'sync-status'] }); },
    });

    const unbanGame = useMutation({
        mutationFn: (gameId: number) => gameAction(gameId, 'unban', 'Failed to unban game'),
        onSuccess: invalidateGames,
    });

    const hideGame = useMutation({
        mutationFn: (gameId: number) => gameAction(gameId, 'hide', 'Failed to hide game'),
        onSuccess: invalidateGames,
    });

    const unhideGame = useMutation({
        mutationFn: (gameId: number) => gameAction(gameId, 'unhide', 'Failed to unhide game'),
        onSuccess: invalidateGames,
    });

    return { banGame, unbanGame, hideGame, unhideGame };
}

export function useAdminGames(search: string, limit = 20, showHidden?: 'only' | 'true') {
    const games = useAdminGamesList(search, limit, showHidden);
    return { games, ...useAdminGameMutations() };
}
