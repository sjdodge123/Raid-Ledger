import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    CommunityChurnResponseDto,
    CommunityEngagementResponseDto,
    CommunityKeyInsightsResponseDto,
    CommunityRadarResponseDto,
    CommunityRefreshResponseDto,
    CommunitySocialGraphResponseDto,
    CommunityTemporalResponseDto,
} from '@raid-ledger/contract';
import { API_BASE_URL } from '../lib/config';
import { getAuthToken } from './use-auth';

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
};

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
    const token = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    const url = `${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers, signal: opts.signal, credentials: 'include' });
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

export function useRefreshCommunityInsights() {
    const queryClient = useQueryClient();
    return useMutation<CommunityRefreshResponseDto, Error>({
        mutationFn: async () => {
            const token = getAuthToken();
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await fetch(`${API_BASE_URL}/insights/community/refresh`, {
                method: 'POST',
                headers,
                credentials: 'include',
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
