/**
 * Batch pricing hook for the discover page (ROK-800).
 * Fetches ITAD pricing for all visible game IDs, chunking into
 * batches of 100 to respect the backend limit.
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { ItadGamePricingDto } from '@raid-ledger/contract';
import { getGamePricingBatch } from '../lib/api-client';

const BATCH_SIZE = 100;

/**
 * Fetch batch pricing for an array of game IDs.
 * Returns a Map of gameId to pricing data (or null).
 * Automatically chunks into groups of 100 to match the API limit.
 */
export function useGamesPricingBatch(
    gameIds: number[],
): Map<number, ItadGamePricingDto | null> {
    const sortedIds = useSortedUniqueIds(gameIds);
    const chunks = useMemo(() => chunkArray(sortedIds, BATCH_SIZE), [sortedIds]);

    const results = useQueries({
        queries: chunks.map((chunk) => ({
            queryKey: ['games', 'pricing', 'batch', chunk],
            queryFn: () => getGamePricingBatch(chunk),
            enabled: chunk.length > 0,
            staleTime: 1000 * 60 * 30,
        })),
    });

    return useMemo(() => {
        const map = new Map<number, ItadGamePricingDto | null>();
        for (const result of results) {
            if (!result.data?.data) continue;
            for (const [key, val] of Object.entries(result.data.data)) {
                map.set(Number(key), val);
            }
        }
        return map;
    }, [results]);
}

/** Deduplicate, filter, and sort IDs for stable query keys. */
function useSortedUniqueIds(gameIds: number[]): number[] {
    return useMemo(() => {
        const unique = [...new Set(gameIds.filter((id) => id > 0))];
        unique.sort((a, b) => a - b);
        return unique;
    }, [gameIds]);
}

/** Split an array into chunks of a given size. */
function chunkArray<T>(arr: T[], size: number): T[][] {
    if (arr.length === 0) return [];
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}
