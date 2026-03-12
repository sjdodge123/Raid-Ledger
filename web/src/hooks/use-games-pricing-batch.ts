/**
 * Batch pricing hook for the discover page (ROK-800).
 * Fetches ITAD pricing for all visible game IDs in a single request,
 * eliminating N+1 per-card pricing fetches.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ItadGamePricingDto } from '@raid-ledger/contract';
import { getGamePricingBatch } from '../lib/api-client';

/**
 * Fetch batch pricing for an array of game IDs.
 * Returns a Map of gameId to pricing data (or null).
 * Skips the fetch entirely when no IDs are provided.
 */
export function useGamesPricingBatch(
    gameIds: number[],
): Map<number, ItadGamePricingDto | null> {
    const sortedIds = useSortedUniqueIds(gameIds);

    const { data } = useQuery({
        queryKey: ['games', 'pricing', 'batch', sortedIds],
        queryFn: () => getGamePricingBatch(sortedIds),
        enabled: sortedIds.length > 0,
        staleTime: 1000 * 60 * 30,
    });

    return useMemo(() => {
        const map = new Map<number, ItadGamePricingDto | null>();
        if (!data?.data) return map;
        for (const [key, val] of Object.entries(data.data)) {
            map.set(Number(key), val);
        }
        return map;
    }, [data]);
}

/** Deduplicate, filter, and sort IDs for stable query keys. */
function useSortedUniqueIds(gameIds: number[]): number[] {
    return useMemo(() => {
        const unique = [...new Set(gameIds.filter((id) => id > 0))];
        unique.sort((a, b) => a - b);
        return unique;
    }, [gameIds]);
}
