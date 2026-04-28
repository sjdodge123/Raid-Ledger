import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SlowQueryDigestDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

/**
 * Slow-query digest API hooks (ROK-1156).
 *
 * The GET endpoint may return either a `SlowQueryDigestDto` or an empty-state
 * payload `{ snapshot: null, baseline: null, entries: [] }` before the first
 * cron snapshot ever runs — both shapes are surfaced as `EmptyDigest`.
 */
export type EmptyDigest = { snapshot: null; baseline: null; entries: [] };
export type SlowQueriesResponse = SlowQueryDigestDto | EmptyDigest;

const DIGEST_QUERY_KEY = ['admin', 'slow-queries', 'digest'];

function authHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken() || ''}`,
    };
}

async function fetchDigest(limit: number): Promise<SlowQueriesResponse> {
    const response = await fetch(
        `${API_BASE_URL}/admin/slow-queries/digest?limit=${limit}`,
        { headers: authHeaders() },
    );
    if (!response.ok) throw new Error('Failed to fetch slow query digest');
    return response.json();
}

async function captureSnapshot(limit: number): Promise<SlowQueryDigestDto> {
    const response = await fetch(
        `${API_BASE_URL}/admin/slow-queries/snapshot?limit=${limit}`,
        { method: 'POST', headers: authHeaders() },
    );
    if (!response.ok) throw new Error('Failed to capture slow query snapshot');
    return response.json();
}

export function useSlowQueriesDigest(limit = 10) {
    return useQuery<SlowQueriesResponse>({
        queryKey: [...DIGEST_QUERY_KEY, limit],
        queryFn: () => fetchDigest(limit),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
        refetchInterval: false,
    });
}

export function useCaptureSlowQuerySnapshot(limit = 10) {
    const queryClient = useQueryClient();
    return useMutation<SlowQueryDigestDto, Error, void>({
        mutationFn: () => captureSnapshot(limit),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: DIGEST_QUERY_KEY });
        },
    });
}
