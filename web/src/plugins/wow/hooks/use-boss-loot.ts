import { useQueries, useQuery } from '@tanstack/react-query';
import { fetchBossesForInstance, fetchLootForBoss } from '../api-client';

/**
 * Fetch boss encounters for a dungeon/raid instance.
 * ROK-247: Boss & Loot Preview on Events
 */
function bossesQuery(instanceId: number | undefined, variant: string) {
    return {
        queryKey: ['wow', 'bosses', instanceId, variant],
        queryFn: () => fetchBossesForInstance(instanceId!, variant),
        enabled: !!instanceId && instanceId > 0,
        staleTime: 10 * 60 * 1000, // boss data rarely changes
    };
}

export function useBossesForInstance(instanceId: number | undefined, variant: string) {
    return useQuery(bossesQuery(instanceId, variant));
}

/**
 * ROK-1719: true once every instance's boss query has settled with an
 * empty list (e.g. hand-seeded Forever instances with no journal data).
 * Shares the cache with useBossesForInstance; false while any is loading.
 */
export function useAllInstancesBossless(instanceIds: number[], variant: string): boolean {
    return useQueries({
        queries: instanceIds.map((id) => bossesQuery(id, variant)),
        combine: (results) => results.length > 0
            && results.every((r) => r.isSuccess && r.data.length === 0),
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
