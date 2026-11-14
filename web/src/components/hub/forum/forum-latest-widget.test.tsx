/** ROK-1175 — the "Latest threads" card: rows → thread links, empty state, visitor gate (Q1/Q3). */
import { describe, it, expect } from 'vitest';
import { renderHook, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { HubForumThreadSummary } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { server } from '../../../test/mocks/server';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildForumThread } from '../../../test/factories/hub-forum';
import ForumLatestWidget, { FORUM_LATEST_EMPTY } from './forum-latest-widget';
import { useForumLatestVisible } from './use-forum-latest-visible';

function createWrapper(): (p: { children: ReactNode }) => ReactNode {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }) => createElement(QueryClientProvider, { client }, children);
}

const LATEST = 'http://localhost:3000/guilds/7/forum/latest';

function ctx(role: 'member' | 'visitor'): HubWidgetCtx {
    return { gameSlug: 'wow', page: { guild: { id: 7, kind: 'wow_guild' }, viewer: { role } } } as unknown as HubWidgetCtx;
}

function serve(threads: HubForumThreadSummary[], total = threads.length): void {
    server.use(http.get(LATEST, () => HttpResponse.json({ threads, total })));
}

describe('ForumLatestWidget (ROK-1175)', () => {
    it('lists the newest threads, each linking to its thread, with the Pinned pill', async () => {
        serve([buildForumThread({ id: 9, title: 'Read me first', pinnedAt: '2026-11-14T09:00:00.000Z' }), buildForumThread({ id: 5, title: 'Raid comp' })]);
        renderWithProviders(<ForumLatestWidget {...ctx('member')} />);
        const link = await screen.findByRole('link', { name: /Raid comp/ });
        expect(link.getAttribute('href')).toContain('?thread=5#forum');
        expect(screen.getAllByTestId('forum-latest-row')).toHaveLength(2);
        expect(screen.getByText('Pinned')).toBeInTheDocument();
    });

    it('shows the empty line when nothing is live', async () => {
        serve([], 0);
        renderWithProviders(<ForumLatestWidget {...ctx('member')} />);
        expect(await screen.findByText(FORUM_LATEST_EMPTY)).toBeInTheDocument();
    });

    it('is visible to a member once the hub has a thread, never to a visitor or on an empty forum (Q3)', async () => {
        serve([buildForumThread()], 1);
        const member = renderHook(() => useForumLatestVisible(ctx('member')), { wrapper: createWrapper() });
        await waitFor(() => expect(member.result.current, 'member + 1 thread').toBe(true));
        const visitor = renderHook(() => useForumLatestVisible(ctx('visitor')), { wrapper: createWrapper() });
        expect(visitor.result.current, 'visitor never sees it').toBe(false);
        serve([], 0);
        const empty = renderHook(() => useForumLatestVisible(ctx('member')), { wrapper: createWrapper() });
        await waitFor(() => expect(empty.result.current).toBe(false));
    });
});
