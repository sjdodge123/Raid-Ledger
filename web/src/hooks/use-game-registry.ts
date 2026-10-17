import { useQuery } from '@tanstack/react-query';
import { fetchGameRegistry, getGameEventTypes } from '../lib/api-client';
import type { GameRegistryDto } from '@raid-ledger/contract';

/**
 * Hook to fetch all registered games from the game registry.
 * Games are cached for 10 minutes since they rarely change.
 */
export function useGameRegistry() {
    const { data, isLoading, error } = useQuery({
        queryKey: ['game-registry'],
        queryFn: fetchGameRegistry,
        staleTime: 1000 * 60 * 10, // 10 minutes — game registry rarely changes
    });

    const games: GameRegistryDto[] = data?.data ?? [];

    return {
        games,
        isLoading,
        error,
    };
}

/**
 * Hook to fetch event types for a specific game.
 * ROK-400: gameId is now a number (games.id) instead of string (game_registry.id).
 */
export function useEventTypes(gameId: number | undefined) {
    return useQuery({
        queryKey: ['event-types', gameId],
        queryFn: () => getGameEventTypes(gameId!),
        enabled: !!gameId,
        staleTime: 1000 * 60 * 10,
    });
}
