/**
 * Batch pricing hook for the discover page (ROK-800, ROK-1047).
 *
 * Fetches ITAD pricing for all visible game IDs in batches of 100.
 * The backend (ROK-1047) returns cached prices immediately; uncached or
 * stale games come back as `null` while the backend enqueues a fetch.
 * When the response contains any nulls, this hook polls every 60s so
 * the UI fills in as the cache backfills, without requiring a manual
 * refresh.
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { ItadGamePricingDto, ItadBatchPricingResponseDto } from '@raid-ledger/contract';
import { getGamePricingBatch } from '../lib/api-client';

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 60_000;

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
            refetchInterval: (query: { state: { data?: ItadBatchPricingResponseDto } }) =>
                hasPendingPrices(query.state.data) ? POLL_INTERVAL_MS : false,
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

/** True if the response contains any null entries (fetch still pending). */
function hasPendingPrices(data: ItadBatchPricingResponseDto | undefined): boolean {
    if (!data?.data) return false;
    for (const value of Object.values(data.data)) {
        if (value === null) return true;
    }
    return false;
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
