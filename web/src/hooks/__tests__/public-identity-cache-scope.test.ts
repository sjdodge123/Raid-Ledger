/**
 * ROK-1734 — queries over the five projected identity routes are viewer-scoped.
 *
 * `/users`, `/users/recent`, `/users/:id/profile`, `/games/:id/activity` and
 * `/games/:id/now-playing` send a member the raw `discordId` + avatar hash and
 * an anonymous viewer a projected shape without them. `logout()` only resets
 * `['auth','me']`, so an unscoped query key lets the anonymous viewer on the
 * same browser read the member's cached payload. Each hook below is rendered
 * as a member, then as an anonymous viewer on the SAME QueryClient: the
 * anonymous render must get the anonymous payload, not the member's cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

let viewer: number | 'anon' = 7;
const payloadFor = () => ({
    who: viewer,
    data: [{ who: viewer }],
    meta: { total: 1, page: 1, limit: 20, hasMore: false },
});

vi.mock('../../lib/api-client', () => ({
    getGameActivity: vi.fn(async () => payloadFor()),
    getGameNowPlaying: vi.fn(async () => payloadFor()),
    getPlayers: vi.fn(async () => payloadFor()),
    getRecentPlayers: vi.fn(async () => payloadFor()),
    getUserProfile: vi.fn(async () => payloadFor()),
}));

vi.mock('../use-auth', () => ({
    getAuthToken: vi.fn().mockReturnValue(null),
    useViewerCacheScope: () => viewer,
}));

import { useGameActivity, useGameNowPlaying } from '../use-games-discover';
import { usePlayers, useInfinitePlayers, useRecentPlayers } from '../use-players';
import { useUserProfile } from '../use-user-profile';

const HOOKS: Array<[string, () => { data?: unknown }]> = [
    ['useGameActivity', () => useGameActivity(1, 'week')],
    ['useGameNowPlaying', () => useGameNowPlaying(1)],
    ['usePlayers', () => usePlayers(1, '')],
    ['useInfinitePlayers', () => ({ data: useInfinitePlayers('').items[0] })],
    ['useRecentPlayers', () => useRecentPlayers()],
    ['useUserProfile', () => useUserProfile(5)],
];

describe('ROK-1734 — projected identity queries are viewer-scoped', () => {
    beforeEach(() => {
        viewer = 7;
    });

    it.each(HOOKS)('%s does not serve the member cache to an anonymous viewer', async (_n, hook) => {
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        });
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(QueryClientProvider, { client }, children);

        const member = renderHook(hook, { wrapper });
        await waitFor(() => expect(member.result.current.data).toMatchObject({ who: 7 }));
        member.unmount();

        viewer = 'anon';
        const anon = renderHook(hook, { wrapper });
        await waitFor(() => expect(anon.result.current.data).toBeDefined());
        expect(anon.result.current.data).toMatchObject({ who: 'anon' });
    });
});
