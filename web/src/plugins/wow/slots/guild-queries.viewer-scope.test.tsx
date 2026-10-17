/**
 * ROK-1785 (Codex P1) — guild payloads are membership-gated, so a cached
 * entry must never be served to a different viewer. Sign out of user 1 and
 * into user 2 on the same QueryClient: user 2 must see their own guilds, not
 * user 1's still-fresh (60s staleTime) cache.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { useMyGuilds } from './guild-queries';
import { useGuildPage } from '../guild/use-guild';

const viewer = vi.hoisted(() => ({ id: 1 }));

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: viewer.id, role: 'member' }, isAuthenticated: true }),
    useViewerCacheScope: () => viewer.id,
}));

const API = 'http://localhost:3000/plugins/wow/guilds';

function guild(id: number, name: string): MyGuild {
    return {
        id, gameId: 7, kind: 'wow_guild', name, region: 'us', realmSlug: 'whitemane', realmName: null, faction: 'horde',
        memberCount: 3, lastSnapshotAt: null, rankIndex: 2, rankName: 'Raider', canEdit: false, gmPostHeadline: null,
    };
}

function wrapperFor(client: QueryClient) {
    return ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
}

describe('guild queries are scoped to the viewer', () => {
    it('useMyGuilds refetches for the next viewer instead of serving the cached guilds', async () => {
        server.use(http.get(`${API}/mine`, () =>
            HttpResponse.json({ guilds: viewer.id === 1 ? [guild(11, 'Iron Vanguard')] : [guild(12, 'Dusk Wardens')] })));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        viewer.id = 1;
        const { result, rerender } = renderHook(() => useMyGuilds(), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(result.current.map((g) => g.name)).toEqual(['Iron Vanguard']));

        viewer.id = 2;
        rerender();
        await waitFor(() => expect(result.current.map((g) => g.name)).toEqual(['Dusk Wardens']));
    });

    it('useGuildPage keys the cached page by viewer', async () => {
        server.use(http.get(`${API}/11`, () => HttpResponse.json({}, { status: 403 })));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        viewer.id = 3;
        renderHook(() => useGuildPage(11), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(client.getQueryCache().find({ queryKey: ['plugins', 'wow', 'guilds', 11, 3], exact: true })).toBeDefined());
    });
});
