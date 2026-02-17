import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

interface AdminGame {
    id: number;
    igdbId: number;
    name: string;
    slug: string;
    coverUrl: string | null;
    cachedAt: string;
    hidden: boolean;
}

interface AdminGameListResponse {
    data: AdminGame[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export function useAdminGames(search: string, page: number, limit = 20, showHidden?: 'only' | 'true') {
    const queryClient = useQueryClient();

    const getHeaders = () => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    });

    const games = useQuery<AdminGameListResponse>({
        queryKey: ['admin', 'games', { search, page, limit, showHidden }],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (showHidden) params.set('showHidden', showHidden);
            params.set('page', String(page));
            params.set('limit', String(limit));

            const response = await fetch(
                `${API_BASE_URL}/admin/settings/games?${params}`,
                { headers: getHeaders() },
            );

            if (!response.ok) throw new Error('Failed to fetch games');
            return response.json();
        },
        enabled: !!getAuthToken(),
        staleTime: 10_000,
    });

    const deleteGame = useMutation<{ success: boolean; message: string }, Error, number>({
        mutationFn: async (gameId) => {
            const response = await fetch(
                `${API_BASE_URL}/admin/settings/games/${gameId}`,
                {
                    method: 'DELETE',
                    headers: getHeaders(),
                },
            );

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to delete game' }));
                throw new Error(error.message || 'Failed to delete game');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'games'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'igdb', 'sync-status'] });
        },
    });

    const hideGame = useMutation<{ success: boolean; message: string }, Error, number>({
        mutationFn: async (gameId) => {
            const response = await fetch(
                `${API_BASE_URL}/admin/settings/games/${gameId}/hide`,
                {
                    method: 'POST',
                    headers: getHeaders(),
                },
            );

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to hide game' }));
                throw new Error(error.message || 'Failed to hide game');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'games'] });
        },
    });

    const unhideGame = useMutation<{ success: boolean; message: string }, Error, number>({
        mutationFn: async (gameId) => {
            const response = await fetch(
                `${API_BASE_URL}/admin/settings/games/${gameId}/unhide`,
                {
                    method: 'POST',
                    headers: getHeaders(),
                },
            );

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to unhide game' }));
                throw new Error(error.message || 'Failed to unhide game');
            }

            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'games'] });
        },
    });

    return { games, deleteGame, hideGame, unhideGame };
}
