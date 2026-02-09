import { useQuery } from '@tanstack/react-query';
import { fetchGameRegistry } from '../lib/api-client';
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
