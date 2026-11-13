/**
 * ROK-2185 (Codex P2) — paging state belongs to one hub. Switching hubs with
 * the same component instance (cached hubs, `#events` active) must not carry
 * the previous hub's rows, buffer or cursor over.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { GuildRecentEventDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import { useGuildPastEvents } from './use-guild-past-events';

function ev(id: number): GuildRecentEventDto {
    return { id, title: `Past ${id}`, startTime: '2029-12-30T20:00:00.000Z', signedUp: 4, attended: 3 };
}

const NONE: readonly GuildRecentEventDto[] = [];

describe('useGuildPastEvents across hubs', () => {
    it('starts clean when the guildId changes on the same instance', async () => {
        const asked: string[] = [];
        server.use(http.get('http://localhost:3000/guilds/:id/events/past', ({ params, request }) => {
            asked.push(`${String(params['id'])}:${new URL(request.url).searchParams.get('cursor') ?? 'first'}`);
            return HttpResponse.json({ events: [ev(Number(params['id']) * 100)], nextCursor: null });
        }));
        const client = createTestQueryClient();
        const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
        const hook = renderHook(({ id }: { id: number }) => useGuildPastEvents(id, NONE), { wrapper, initialProps: { id: 7 } });
        act(() => hook.result.current.showMore());
        await waitFor(() => expect(hook.result.current.shown.map((e) => e.id)).toEqual([700]));
        expect(hook.result.current.canShowMore, 'hub 7 history is exhausted').toBe(false);
        hook.rerender({ id: 8 });
        expect(hook.result.current.shown, 'hub 8 shows none of hub 7 rows').toEqual([]);
        expect(hook.result.current.canShowMore, 'hub 8 has not been asked yet').toBe(true);
        expect(hook.result.current.foundNothing).toBe(false);
        act(() => hook.result.current.showMore());
        await waitFor(() => expect(hook.result.current.shown.map((e) => e.id)).toEqual([800]));
        expect(asked, 'hub 8 starts from its own first page, not hub 7 cursor').toEqual(['7:first', '8:first']);
    });
});
