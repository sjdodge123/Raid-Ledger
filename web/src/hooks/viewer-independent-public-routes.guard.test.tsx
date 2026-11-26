/**
 * ROK-2334 guard: every query an un-authed route (`/p/*`, `/privacy`) creates is
 * tagged `meta: VIEWER_INDEPENDENT_META` at its `useQuery`. An untagged one is
 * reset by a cross-tab logout (`dropViewerPrivateCaches`) and, with no token to
 * refetch it, the public page sits pending until a reload — the bug the old
 * hand-kept prefix allowlist kept reintroducing (one missing key per Codex round).
 *
 * Renders the REAL route table at each public path with its data loaded, then
 * asserts (1) every query but `['auth','me']` carries the tag, and (2) a logout
 * drop leaves no loaded query pending or evicted.
 */
import { Suspense } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Query, QueryClient } from '@tanstack/react-query';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { activateWowPlugin } from '../test/activate-wow-plugin';
import { createMockPollSharePreview, pollSharePreviewHandler } from '../test/mocks/poll-share-handlers';
import {
    SEEDED_PUBLIC_GUILD_SLUG,
    createMockPublicGuildCard,
    publicGuildCardHandler,
} from '../test/mocks/public-guild-card-handlers';
import { AppRoutes } from '../app-routes';
import { usePluginStore } from '../stores/plugin-store';
import { clearAccessToken } from '../lib/api/access-token-store';
import { dropViewerPrivateCaches } from './viewer-private-caches';

const API_BASE = 'http://localhost:3000';

const publicLineupHandler = http.get(`${API_BASE}/lineups/public/:slug`, () =>
    HttpResponse.json({
        title: 'Guard Lineup',
        description: null,
        status: 'building',
        decision: null,
        communityName: 'Raid Ledger',
    }),
);

interface PublicRouteCase {
    path: string;
    /** The page's own data query; the render is "loaded" once it succeeds. */
    mainKey: readonly string[];
}

const PUBLIC_ROUTES: readonly PublicRouteCase[] = [
    { path: '/p/lineup/aBcDeFgHiJ12', mainKey: ['lineups', 'public'] },
    { path: '/p/poll/guard-token', mainKey: ['poll-share', 'preview'] },
    { path: `/p/guild/${SEEDED_PUBLIC_GUILD_SLUG}`, mainKey: ['wow', 'public-guild-card'] },
    { path: '/privacy', mainKey: ['system', 'status'] },
];

function isAuthMe(query: Query): boolean {
    const key = query.queryKey;
    return key.length === 2 && key[0] === 'auth' && key[1] === 'me';
}

function startsWith(query: Query, prefix: readonly string[]): boolean {
    return prefix.every((part, i) => query.queryKey[i] === part);
}

/** Every query the route created except the auth seed, which the drop always keeps. */
function routeQueries(queryClient: QueryClient): Query[] {
    return queryClient.getQueryCache().getAll().filter((query) => !isAuthMe(query));
}

const keyOf = (query: Query) => JSON.stringify(query.queryKey);

async function renderLoaded(route: PublicRouteCase): Promise<QueryClient> {
    const { queryClient } = renderWithProviders(
        <Suspense fallback={null}><AppRoutes /></Suspense>,
        { initialEntries: [route.path] },
    );
    await waitFor(() => {
        const main = routeQueries(queryClient).find((query) => startsWith(query, route.mainKey));
        expect(main?.state.status).toBe('success');
    });
    await waitFor(() => { expect(queryClient.isFetching()).toBe(0); });
    return queryClient;
}

const initialPluginState = usePluginStore.getState();

describe('ROK-2334: un-authed routes only create viewer-independent queries', () => {
    beforeEach(() => {
        clearAccessToken();
        activateWowPlugin();
        server.use(
            publicLineupHandler,
            pollSharePreviewHandler(createMockPollSharePreview()),
            publicGuildCardHandler(createMockPublicGuildCard()),
        );
    });
    afterEach(() => {
        usePluginStore.setState(initialPluginState, true);
    });

    it.each(PUBLIC_ROUTES)('$path tags every query it creates', async (route) => {
        const queryClient = await renderLoaded(route);
        const untagged = routeQueries(queryClient)
            .filter((query) => query.meta?.['viewerIndependent'] !== true)
            .map(keyOf);
        expect(untagged, `queries on ${route.path} without meta.viewerIndependent`).toEqual([]);
    });

    it.each(PUBLIC_ROUTES)('$path keeps every loaded query across a cross-tab logout drop', async (route) => {
        const queryClient = await renderLoaded(route);
        const loaded = routeQueries(queryClient).filter((query) => query.state.status === 'success');
        expect(loaded.length).toBeGreaterThan(0);
        act(() => { dropViewerPrivateCaches(queryClient); });
        const cache = queryClient.getQueryCache();
        const stuck = loaded
            .filter((query) => cache.get(query.queryHash) !== query || query.state.status !== 'success')
            .map(keyOf);
        expect(stuck, `queries on ${route.path} a logout drop reset or evicted`).toEqual([]);
    });
});
