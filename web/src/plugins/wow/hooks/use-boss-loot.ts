import { useQuery } from '@tanstack/react-query';
import { fetchBossesForInstance, fetchLootForBoss } from '../api-client';

/**
 * Fetch boss encounters for a dungeon/raid instance.
 * ROK-247: Boss & Loot Preview on Events
 */
export function useBossesForInstance(instanceId: number | undefined, variant: string) {
    return useQuery({
        queryKey: ['wow', 'bosses', instanceId, variant],
        queryFn: () => fetchBossesForInstance(instanceId!, variant),
        enabled: !!instanceId && instanceId > 0,
        staleTime: 10 * 60 * 1000, // boss data rarely changes
    });
}

/**
 * Fetch loot for a specific boss (on-demand, when boss is expanded).
 * ROK-247: Boss & Loot Preview on Events
 */
export function useLootForBoss(bossId: number | undefined, variant: string) {
    return useQuery({
        queryKey: ['wow', 'loot', bossId, variant],
        queryFn: () => fetchLootForBoss(bossId!, variant),
        enabled: !!bossId && bossId > 0,
        staleTime: 10 * 60 * 1000,
    });
}
