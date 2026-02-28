import { useQuery } from '@tanstack/react-query';
import type { GameDiscoverResponseDto, GameDetailDto, GameStreamsResponseDto, ActivityPeriod, GameActivityResponseDto, GameNowPlayingResponseDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';
import { getGameActivity, getGameNowPlaying } from '../lib/api-client';

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

/**
 * ROK-443: Hook for fetching community activity for a game.
 */
export function useGameActivity(gameId: number | undefined, period: ActivityPeriod) {
    return useQuery<GameActivityResponseDto>({
        queryKey: ['games', 'activity', gameId, period],
        queryFn: async () => {
            if (!gameId) throw new Error('Game ID required');
            return getGameActivity(gameId, period);
        },
        enabled: !!gameId,
        staleTime: 5 * 60 * 1000,
    });
}

/**
 * ROK-443: Hook for fetching users currently playing a game.
 */
export function useGameNowPlaying(gameId: number | undefined) {
    return useQuery<GameNowPlayingResponseDto>({
        queryKey: ['games', 'nowPlaying', gameId],
        queryFn: async () => {
            if (!gameId) throw new Error('Game ID required');
            return getGameNowPlaying(gameId);
        },
        enabled: !!gameId,
        staleTime: 1000 * 60,
        refetchInterval: 60_000,
    });
}
