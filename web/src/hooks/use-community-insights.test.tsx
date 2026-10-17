/**
 * use-community-insights.test.ts (ROK-1099)
 *
 * Covers the 7 react-query hooks against MSW-mocked backend endpoints.
 * Happy path for each read, 503 → NoSnapshotYetError path, and mutation
 * invalidation behaviour for the refresh hook.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../test/mocks/server';
import {
    useCommunityRadar,
    useCommunityEngagement,
    useCommunityChurn,
    useCommunitySocialGraph,
    useCommunityTemporal,
    useCommunityKeyInsights,
    useRefreshCommunityInsights,
    COMMUNITY_INSIGHTS_KEYS,
    NoSnapshotYetError,
    isNoSnapshotYet,
} from './use-community-insights';

const API = 'http://localhost:3000';

function makeWrapper(client: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };
}

function newClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });
}

const snapshotDate = '2026-04-22';

beforeEach(() => {
    server.use(
        http.get(`${API}/insights/community/radar`, () =>
            HttpResponse.json({
                snapshotDate, axes: [], archetypes: [], driftSeries: [], dominantArchetype: null,
            }),
        ),
        http.get(`${API}/insights/community/engagement`, () =>
            HttpResponse.json({ snapshotDate, weeklyActiveUsers: [], intensityHistogram: [] }),
        ),
        http.get(`${API}/insights/community/churn`, ({ request }) => {
            const url = new URL(request.url);
            const thresholdPct = Number(url.searchParams.get('thresholdPct') ?? 70);
            return HttpResponse.json({
                snapshotDate, thresholdPct, baselineWeeks: 12, recentWeeks: 4,
                notEnoughHistory: false, atRisk: [], candidates: [],
            });
        }),
        http.get(`${API}/insights/community/social-graph`, () =>
            HttpResponse.json({ snapshotDate, nodes: [], edges: [], cliques: [], tasteLeaders: [] }),
        ),
        http.get(`${API}/insights/community/temporal`, () =>
            HttpResponse.json({ snapshotDate, heatmap: [], peakHours: [] }),
        ),
        http.get(`${API}/insights/community/key-insights`, () =>
            HttpResponse.json({ snapshotDate, insights: [] }),
        ),
        http.post(`${API}/insights/community/refresh`, () =>
            HttpResponse.json({ enqueued: true, jobId: 'stub-job-1' }, { status: 202 }),
        ),
    );
});

describe('useCommunityRadar', () => {
    it('returns snapshot payload on 200', async () => {
        const client = newClient();
        const { result } = renderHook(() => useCommunityRadar(), { wrapper: makeWrapper(client) });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.snapshotDate).toBe(snapshotDate);
    });

    it('surfaces NoSnapshotYetError on 503', async () => {
        server.use(
            http.get(`${API}/insights/community/radar`, () =>
                HttpResponse.json({ error: 'no_snapshot_yet' }, { status: 503 }),
            ),
        );
        const client = newClient();
        const { result } = renderHook(() => useCommunityRadar(), { wrapper: makeWrapper(client) });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBeInstanceOf(NoSnapshotYetError);
        expect(isNoSnapshotYet(result.current.error)).toBe(true);
    });
});

describe('other read hooks', () => {
    it('engagement resolves', async () => {
        const client = newClient();
        const { result } = renderHook(() => useCommunityEngagement(), { wrapper: makeWrapper(client) });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('churn honours thresholdPct query param', async () => {
        const client = newClient();
        const { result } = renderHook(
            () => useCommunityChurn({ thresholdPct: 85 }),
            { wrapper: makeWrapper(client) },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.thresholdPct).toBe(85);
    });

    it('social graph resolves with limit + minWeight', async () => {
        const client = newClient();
        const { result } = renderHook(
            () => useCommunitySocialGraph({ limit: 50, minWeight: 2 }),
            { wrapper: makeWrapper(client) },
        );
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('temporal resolves', async () => {
        const client = newClient();
        const { result } = renderHook(() => useCommunityTemporal(), { wrapper: makeWrapper(client) });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('key insights resolves', async () => {
        const client = newClient();
        const { result } = renderHook(() => useCommunityKeyInsights(), { wrapper: makeWrapper(client) });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useRefreshCommunityInsights', () => {
    it('invalidates all community-insights queries on success', async () => {
        const client = newClient();
        client.setQueryData(COMMUNITY_INSIGHTS_KEYS.radar(), { snapshotDate: 'old' });
        const { result } = renderHook(() => useRefreshCommunityInsights(), {
            wrapper: makeWrapper(client),
        });
        let mutationResult: { jobId: string } | undefined;
        await act(async () => {
            mutationResult = await result.current.mutateAsync();
        });
        expect(mutationResult?.jobId).toBe('stub-job-1');
        // Invalidation marks queries stale — staleness is observable via getQueryState
        const state = client.getQueryState(COMMUNITY_INSIGHTS_KEYS.radar());
        expect(state?.isInvalidated).toBe(true);
    });
});
