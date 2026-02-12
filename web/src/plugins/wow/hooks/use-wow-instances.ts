import { useQuery } from '@tanstack/react-query';
import { fetchWowInstances, fetchWowInstanceDetail } from '../api-client';

/**
 * Hook to fetch WoW dungeon or raid instance lists for content selection.
 * Only enabled when both gameVariant and type are provided.
 */
export function useWowInstances(
    gameVariant: string | undefined,
    type: 'dungeon' | 'raid' | undefined,
) {
    return useQuery({
        queryKey: ['wow-instances', gameVariant, type],
        queryFn: () => fetchWowInstances(gameVariant!, type!),
        enabled: !!gameVariant && !!type,
        staleTime: 1000 * 60 * 60, // 1h client cache
    });
}

/**
 * Hook to fetch detail for a specific WoW instance (level requirements, player count).
 */
export function useWowInstanceDetail(
    instanceId: number | undefined,
    gameVariant: string | undefined,
) {
    return useQuery({
        queryKey: ['wow-instance-detail', instanceId, gameVariant],
        queryFn: () => fetchWowInstanceDetail(instanceId!, gameVariant!),
        enabled: !!instanceId && !!gameVariant,
        staleTime: 1000 * 60 * 60,
    });
}
