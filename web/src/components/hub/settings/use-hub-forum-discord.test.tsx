/**
 * ROK-2272 S5b — a hub forum bind or unlink changes the admin "Event planning
 * forum" candidates, so both mutations mark that cached read stale (the card
 * would otherwise show the old picker / read-only line for five minutes).
 */
import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { forumDiscordBinding } from '../../../test/mocks/hub-forum-discord-handlers';
import { planningForumSettings } from '../../../test/mocks/event-planning-forum-handlers';
import { EVENT_PLANNING_FORUM_KEY } from '../../../hooks/admin/use-event-planning-forum';
import { useBindHubForumDiscord, useUnlinkHubForumDiscord } from './use-hub-forum-discord';

const BASE = 'http://localhost:3000/guilds/9';

function setup(): { client: QueryClient; wrapper: (p: { children: ReactNode }) => ReactNode } {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } } });
    client.setQueryData([...EVENT_PLANNING_FORUM_KEY], planningForumSettings());
    server.use(
        http.put(`${BASE}/forum-discord`, () => HttpResponse.json({ binding: forumDiscordBinding() })),
        http.delete(`${BASE}/forum-discord`, () => new HttpResponse(null, { status: 204 })),
    );
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { client, wrapper };
}

const planningStale = (client: QueryClient): boolean | undefined =>
    client.getQueryState([...EVENT_PLANNING_FORUM_KEY])?.isInvalidated;

describe('hub forum bind/unlink refresh the event planning forum read', () => {
    it('bind marks the event planning forum query stale', async () => {
        const { client, wrapper } = setup();
        const { result } = renderHook(() => useBindHubForumDiscord(9), { wrapper });
        expect(planningStale(client)).toBe(false);
        await act(() => result.current.mutateAsync({ mode: 'existing', channelId: '423456789012345678', ack: true }));
        expect(planningStale(client)).toBe(true);
    });

    it('unlink marks the event planning forum query stale', async () => {
        const { client, wrapper } = setup();
        const { result } = renderHook(() => useUnlinkHubForumDiscord(9), { wrapper });
        await act(() => result.current.mutateAsync(false));
        expect(planningStale(client)).toBe(true);
    });
});
