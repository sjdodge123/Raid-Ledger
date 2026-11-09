/**
 * ROK-2152 — the nav's "Popular hubs": up to 5 hubs the viewer may see but is
 * not in, from `GET /hubs?membership=not-joined&sort=members&limit=10`, with
 * banned, staff-hidden and already-mine rows dropped on the client (D1/D2).
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { HubDirectoryEntry, MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import { communityHubHandlers, createMockHubDirectoryPage, createMockHubEntry } from '../../../test/handlers/community-hubs';
import { selectPopularHubs, usePopularHubs, usePopularHubsQuery } from './popular-hubs-queries';

const auth = vi.hoisted(() => ({ signedIn: true }));

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => (auth.signedIn
        ? { user: { id: 1, role: 'member' }, isAuthenticated: true }
        : { user: null, isAuthenticated: false }),
}));

const entry = (id: number, extra: Partial<HubDirectoryEntry> = {}): HubDirectoryEntry =>
    createMockHubEntry({ id, name: `Hub ${id}`, memberCount: 100 - id, ...extra });

const ids = (hubs: HubDirectoryEntry[]): number[] => hubs.map((h) => h.id);

function mine(id: number): MyGuild {
    return {
        id, gameId: 7, kind: 'game_community', name: `Mine ${id}`, region: 'community', realmSlug: null, realmName: null,
        faction: null, memberCount: 3, lastSnapshotAt: null, rankIndex: null, rankName: null, canEdit: false, gmPostHeadline: null,
    };
}

function wrapperFor(client: QueryClient): ({ children }: { children: ReactNode }) => ReactNode {
    return function Wrapper({ children }: { children: ReactNode }): ReactNode {
        return createElement(QueryClientProvider, { client }, children);
    };
}

/** Records every `GET /hubs` request URL MSW sees. */
function recordDirectoryRequests(): URL[] {
    const seen: URL[] = [];
    server.events.on('request:start', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname === '/hubs') seen.push(url);
    });
    return seen;
}

beforeEach(() => {
    auth.signedIn = true;
    server.events.removeAllListeners();
});

describe('selectPopularHubs', () => {
    it('drops banned, staff-hidden and already-mine rows, keeps server order, and caps at 5', () => {
        const items = [
            entry(1), entry(2, { viewer: 'banned' }), entry(3), entry(4, { hidden: true }),
            entry(5), entry(6), entry(7), entry(8), entry(9),
        ];
        expect(ids(selectPopularHubs(items, new Set([6])))).toEqual([1, 3, 5, 7, 8]);
    });

    it('keeps a staff row that is not hidden (hidden: false)', () => {
        expect(ids(selectPopularHubs([entry(1, { hidden: false })], new Set()))).toEqual([1]);
    });

    it('fewer than 5 eligible rows → only those, no padding', () => {
        expect(ids(selectPopularHubs([entry(1), entry(2), entry(3)], new Set()))).toEqual([1, 2, 3]);
    });

    it('every row ineligible → []', () => {
        const items = [entry(1, { viewer: 'banned' }), entry(2, { hidden: true }), entry(3)];
        expect(selectPopularHubs(items, new Set([3]))).toEqual([]);
    });
});

describe('usePopularHubsQuery', () => {
    it('signed out → never requests GET /hubs', () => {
        auth.signedIn = false;
        server.use(...communityHubHandlers());
        const seen = recordDirectoryRequests();
        const { result } = renderHook(() => usePopularHubsQuery(), { wrapper: wrapperFor(createTestQueryClient()) });
        expect(result.current.fetchStatus).toBe('idle');
        expect(seen).toHaveLength(0);
    });

    it('signed in → asks for not-joined hubs by members, 10 at a time, under the viewer-scoped nav key', async () => {
        server.use(...communityHubHandlers({ directory: createMockHubDirectoryPage({ items: [entry(1)] }) }));
        const seen = recordDirectoryRequests();
        const client = createTestQueryClient();
        const { result } = renderHook(() => usePopularHubsQuery(), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(seen).toHaveLength(1);
        expect(seen[0]?.searchParams.get('membership')).toBe('not-joined');
        expect(seen[0]?.searchParams.get('sort')).toBe('members');
        expect(seen[0]?.searchParams.get('limit')).toBe('10');
        expect(ids(client.getQueryData<{ items: HubDirectoryEntry[] }>(['hubs-directory', 'nav-popular', 1])?.items ?? []))
            .toEqual([1]);
    });
});

describe('usePopularHubs', () => {
    it('filters the fetched page against the viewer\'s hubs and reports settled', async () => {
        server.use(...communityHubHandlers({ directory: createMockHubDirectoryPage({ items: [entry(1), entry(2), entry(3)] }) }));
        const { result } = renderHook(() => usePopularHubs([mine(2)]), { wrapper: wrapperFor(createTestQueryClient()) });
        expect(result.current.settled).toBe(false);
        await waitFor(() => expect(result.current.settled).toBe(true));
        expect(ids(result.current.hubs)).toEqual([1, 3]);
    });

    it('a failed request → settled with no hubs (the section stays hidden)', async () => {
        server.use(http.get('http://localhost:3000/hubs', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const { result } = renderHook(() => usePopularHubs([]), { wrapper: wrapperFor(createTestQueryClient()) });
        await waitFor(() => expect(result.current.settled).toBe(true));
        expect(result.current.hubs).toEqual([]);
    });
});
