/**
 * ROK-1787 (Codex P2) — signup/roster/event mutations live in core and never
 * invalidate the plugin's guild-raids key, so the summary must refetch every
 * time the guild page mounts instead of serving the global 5-minute cache.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { emptyGuildRaids } from '../../../test/mocks/guild-raids-handlers';
import { useGuildRaids } from './use-guild';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useViewerCacheScope: () => 1,
}));

const RAIDS_URL = 'http://localhost:3000/guilds/11/raids';

function wrapperFor(client: QueryClient) {
    return ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
}

describe('useGuildRaids freshness', () => {
    it('refetches on remount despite the app-wide 5-minute staleTime', async () => {
        let calls = 0;
        server.use(http.get(RAIDS_URL, () => {
            calls += 1;
            return HttpResponse.json(emptyGuildRaids);
        }));
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: 1000 * 60 * 5 } },
        });
        const first = renderHook(() => useGuildRaids(11), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
        first.unmount();

        const second = renderHook(() => useGuildRaids(11), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(second.result.current.isFetching).toBe(false));
        expect(calls).toBe(2);
    });
});
