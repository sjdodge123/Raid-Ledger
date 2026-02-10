import { useQuery } from '@tanstack/react-query';
import type { GameDiscoverResponseDto, GameDetailDto, GameStreamsResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

const getHeaders = () => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    const token = getAuthToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
};

/**
 * Hook for fetching game discovery rows (carousels).
 */
export function useGamesDiscover() {
    return useQuery<GameDiscoverResponseDto>({
        queryKey: ['games', 'discover'],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/games/discover`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to load game discovery');
            return response.json();
        },
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Hook for fetching a single game's full detail.
 */
export function useGameDetail(id: number | undefined) {
    return useQuery<GameDetailDto>({
        queryKey: ['games', 'detail', id],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/games/${id}`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to load game details');
            return response.json();
        },
        enabled: !!id,
        staleTime: 1000 * 60 * 10,
    });
}

/**
 * Hook for fetching live Twitch streams for a game.
 */
export function useGameStreams(id: number | undefined) {
    return useQuery<GameStreamsResponseDto>({
        queryKey: ['games', 'streams', id],
        queryFn: async () => {
            const response = await fetch(`${API_BASE_URL}/games/${id}/streams`, {
                headers: getHeaders(),
            });
            if (!response.ok) throw new Error('Failed to load streams');
            return response.json();
        },
        enabled: !!id,
        staleTime: 1000 * 60, // 1 minute
        refetchInterval: 60_000, // Refresh every 60 seconds
    });
}
