import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    CohortGameFrequencyQueryDto,
    CohortGameFrequencyResponseDto,
    CommunityChurnResponseDto,
    CommunityEngagementResponseDto,
    CommunityKeyInsightsResponseDto,
    CommunityRadarResponseDto,
    CommunityRefreshResponseDto,
    CommunitySocialGraphResponseDto,
    CommunityTemporalResponseDto,
} from '@raid-ledger/contract';
import { fetchWithAuth } from '../lib/api/fetch-api';

const STALE_MS = 60_000;

export const COMMUNITY_INSIGHTS_KEYS = {
    all: ['community-insights'] as const,
    radar: () => [...COMMUNITY_INSIGHTS_KEYS.all, 'radar'] as const,
    engagement: () => [...COMMUNITY_INSIGHTS_KEYS.all, 'engagement'] as const,
    churn: (thresholdPct?: number) =>
        [...COMMUNITY_INSIGHTS_KEYS.all, 'churn', thresholdPct ?? 'default'] as const,
    socialGraph: (limit?: number, minWeight?: number) =>
        [...COMMUNITY_INSIGHTS_KEYS.all, 'social-graph', limit ?? 'default', minWeight ?? 'default'] as const,
    temporal: () => [...COMMUNITY_INSIGHTS_KEYS.all, 'temporal'] as const,
    keyInsights: () => [...COMMUNITY_INSIGHTS_KEYS.all, 'key-insights'] as const,
    cohortFrequency: (mode: CohortFrequencyMode) =>
        [...COMMUNITY_INSIGHTS_KEYS.all, 'cohort-frequency', mode] as const,
};

export type CohortFrequencyMode = CohortGameFrequencyQueryDto['mode'];

/**
 * Error type surfaced when the backend has not yet produced a snapshot.
 * UI renders an empty state with a "Run refresh now" button for admins.
 */
export class NoSnapshotYetError extends Error {
    constructor() {
        super('no_snapshot_yet');
        this.name = 'NoSnapshotYetError';
    }
}

interface FetchOptions {
    signal?: AbortSignal;
    query?: Record<string, string | number | undefined>;
}

async function insightsFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    const res = await fetchWithAuth(`${path}${qs ? `?${qs}` : ''}`, { signal: opts.signal });
    if (res.status === 503) throw new NoSnapshotYetError();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
}

export function useCommunityRadar() {
    return useQuery<CommunityRadarResponseDto, Error>({
        queryKey: COMMUNITY_INSIGHTS_KEYS.radar(),
        queryFn: ({ signal }) => insightsFetch('/insights/community/radar', { signal }),
        staleTime: STALE_MS,
        retry: false,
    });
}

export function useCommunityEngagement() {
    return useQuery<CommunityEngagementResponseDto, Error>({
        queryKey: COMMUNITY_INSIGHTS_KEYS.engagement(),
        queryFn: ({ signal }) => insightsFetch('/insights/community/engagement', { signal }),
        staleTime: STALE_MS,
        retry: false,
    });
}

export function useCommunityChurn(params?: { thresholdPct?: number }) {
    return useQuery<CommunityChurnResponseDto, Error>({
        queryKey: COMMUNITY_INSIGHTS_KEYS.churn(params?.thresholdPct),
        queryFn: ({ signal }) =>
            insightsFetch('/insights/community/churn', {
                signal,
                query: { thresholdPct: params?.thresholdPct },
            }),
        staleTime: STALE_MS,
        retry: false,
    });
}

export function useCommunitySocialGraph(params?: { limit?: number; minWeight?: number }) {
    return useQuery<CommunitySocialGraphResponseDto, Error>({
        queryKey: COMMUNITY_INSIGHTS_KEYS.socialGraph(params?.limit, params?.minWeight),
        queryFn: ({ signal }) =>
            insightsFetch('/insights/community/social-graph', {
                signal,
                query: { limit: params?.limit, minWeight: params?.minWeight },
            }),
        staleTime: STALE_MS,
        retry: false,
    });
}

export function useCommunityTemporal() {
    return useQuery<CommunityTemporalResponseDto, Error>({
        queryKey: COMMUNITY_INSIGHTS_KEYS.temporal(),
        queryFn: ({ signal }) => insightsFetch('/insights/community/temporal', { signal }),
        staleTime: STALE_MS,
        retry: false,
    });
}

export function useCommunityKeyInsights() {
    return useQuery<CommunityKeyInsightsResponseDto, Error>({
        queryKey: COMMUNITY_INSIGHTS_KEYS.keyInsights(),
        queryFn: ({ signal }) => insightsFetch('/insights/community/key-insights', { signal }),
        staleTime: STALE_MS,
        retry: false,
    });
}

/**
 * ROK-1310 — live aggregation over `community_lineup_cohort_memory`.
 *
 * Unlike the snapshot-backed panels above this endpoint NEVER answers
 * 503 `no_snapshot_yet`: an empty cohort table is a legitimate 200 with
 * `buckets: []`, so callers drive their empty state off the payload rather
 * than off `NoSnapshotYetError`.
 */
export function useCohortGameFrequency(mode: CohortFrequencyMode) {
    return useQuery<CohortGameFrequencyResponseDto, Error>({
        queryKey: COMMUNITY_INSIGHTS_KEYS.cohortFrequency(mode),
        queryFn: ({ signal }) =>
            insightsFetch('/insights/community/cohort-game-frequency', {
                signal,
                query: { mode },
            }),
        staleTime: STALE_MS,
        retry: false,
    });
}

export function useRefreshCommunityInsights() {
    const queryClient = useQueryClient();
    return useMutation<CommunityRefreshResponseDto, Error>({
        mutationFn: async () => {
            const res = await fetchWithAuth('/insights/community/refresh', {
                method: 'POST',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return (await res.json()) as CommunityRefreshResponseDto;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: COMMUNITY_INSIGHTS_KEYS.all });
        },
    });
}

export function isNoSnapshotYet(error: unknown): boolean {
    return error instanceof NoSnapshotYetError;
}
