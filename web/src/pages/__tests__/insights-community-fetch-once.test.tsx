/**
 * insights-community-fetch-once.test.tsx (ROK-1128 #14)
 *
 * Regression guard: opening /insights mounts the Community tab once and each
 * /insights/community/* endpoint is requested exactly once — including when
 * auth resolves after first paint (the hub shows a skeleton, then the
 * <Outlet/>). Mirrors the production route shape (app-routes.tsx: hub +
 * index redirect + lazy tabs under a Suspense boundary, as App.tsx does).
 */
import { Suspense, useSyncExternalStore } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { createTestQueryClient, renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';
import { InsightsCommunityTab, InsightsHubPage } from '../../lazy-routes';

vi.mock('../../components/insights/community/SocialGraphCanvas', () => ({
    SocialGraphCanvas: () => <div data-testid="social-graph-canvas-stub">stub</div>,
}));

const authStore = vi.hoisted(() => {
    let isLoading = true;
    const listeners = new Set<() => void>();
    return {
        get: () => isLoading,
        set: (next: boolean) => {
            isLoading = next;
            listeners.forEach((l) => l());
        },
        subscribe: (l: () => void) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
    };
});

vi.mock('../../hooks/use-auth', async (orig) => {
    const actual = await orig<typeof import('../../hooks/use-auth')>();
    return {
        ...actual,
        useAuth: () => {
            const isLoading = useSyncExternalStore(authStore.subscribe, authStore.get);
            const user = isLoading ? null : { id: 1, username: 'stub', role: 'admin' as const };
            return { user, isAuthenticated: !isLoading, isLoading, error: null, refetch: () => Promise.resolve() };
        },
    };
});

const PANEL_TESTIDS = [
    'community-insights-radar',
    'community-insights-engagement',
    'community-insights-social-graph',
    'community-insights-temporal',
    'community-insights-key-insights',
    'community-insights-cohort-frequency',
];

let hits: Map<string, number>;

function countRequest({ request }: { request: Request }) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/insights/community/')) return;
    hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
}

function renderInsightsAt(path: string) {
    const queryClient = createTestQueryClient();
    renderWithProviders(
        <Suspense fallback={<div data-testid="route-suspense" />}>
            <Routes>
                <Route path="/insights" element={<InsightsHubPage />}>
                    <Route index element={<Navigate to="/insights/community" replace />} />
                    <Route path="community" element={<InsightsCommunityTab />} />
                </Route>
            </Routes>
        </Suspense>,
        { initialEntries: [path], queryClient },
    );
    return queryClient;
}

async function settle(queryClient: ReturnType<typeof createTestQueryClient>) {
    for (const id of PANEL_TESTIDS) expect(await screen.findByTestId(id)).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

describe('Insights community tab fetches each endpoint once (ROK-1128 #14)', () => {
    beforeEach(() => {
        hits = new Map();
        authStore.set(true);
        server.events.on('request:start', countRequest);
    });

    afterEach(() => {
        server.events.removeListener('request:start', countRequest);
    });

    it.each(['/insights/community', '/insights'])(
        'requests every endpoint exactly once when auth resolves after first paint (%s)',
        async (path) => {
            const queryClient = renderInsightsAt(path);
            expect(await screen.findByTestId('insights-hub')).toBeInTheDocument();
            expect(hits.size).toBe(0);

            act(() => authStore.set(false));
            await settle(queryClient);

            const duplicates = [...hits].filter(([, n]) => n !== 1);
            expect(hits.size).toBeGreaterThanOrEqual(6);
            expect(duplicates).toEqual([]);
        },
    );
});
