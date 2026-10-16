/**
 * ROK-1599 Codex P1 (r4): a Get/Reset POST still in flight when the viewer
 * changes must not write the OLD viewer's bearer feed URL into the next
 * viewer's Calendars overview cache.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import type { CalendarsOverview } from '@raid-ledger/contract';
import { server } from '../test/mocks/server';
import {
    CALENDAR_FEED_URL, CALENDAR_FEED_RESET_URL_FIXTURE, calendarsOverviewVariants,
} from '../test/mocks/calendar-sync-handlers';
import { clearAccessToken, setAccessToken } from '../lib/api/access-token-store';
import { CALENDARS_OVERVIEW_KEY } from './use-calendar-sync';
import { useCreateOrResetFeed } from './use-calendar-feed';

const OVERVIEW = [...CALENDARS_OVERVIEW_KEY];

/** An unsigned JWT (readClaims never verifies). `n` keeps same-identity tokens distinct. */
function jwt(claims: Record<string, unknown>, n = 0): string {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64({ alg: 'none' })}.${b64({ exp: 4102444800 + n, ...claims })}.sig`;
}

/** The POST answers only when `release()` is called. */
function holdFeedPost(): { release: () => void } {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post(CALENDAR_FEED_URL, async () => {
        await gate;
        return HttpResponse.json({ url: CALENDAR_FEED_RESET_URL_FIXTURE });
    }));
    return { release: () => release() };
}

function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useCreateOrResetFeed(), { wrapper });
    return { client, result };
}

function cachedFeedUrl(client: QueryClient): string | null | undefined {
    return client.getQueryData<CalendarsOverview>(OVERVIEW)?.feed?.url;
}

describe('ROK-1599: useCreateOrResetFeed fences its cache write to the viewer who POSTed', () => {
    beforeEach(() => {
        clearAccessToken();
        setAccessToken(jwt({ sub: 1 }));
    });
    afterEach(() => clearAccessToken());

    it('an identity change mid-POST leaves the new viewer\'s overview without the old viewer\'s link', async () => {
        const post = holdFeedPost();
        const { client, result } = setup();
        act(() => result.current.mutate());
        await waitFor(() => expect(result.current.isPending).toBe(true));
        setAccessToken(jwt({ sub: 2 }));
        client.setQueryData(OVERVIEW, calendarsOverviewVariants.available);
        post.release();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedFeedUrl(client), 'viewer 1\'s feed URL was written into viewer 2\'s cache').not.toBe(
            CALENDAR_FEED_RESET_URL_FIXTURE,
        );
    });

    it('ending impersonation mid-POST (same subject, impersonator gone) is an identity change too', async () => {
        setAccessToken(jwt({ sub: 9, impersonatedBy: 1 }));
        const post = holdFeedPost();
        const { client, result } = setup();
        act(() => result.current.mutate());
        await waitFor(() => expect(result.current.isPending).toBe(true));
        setAccessToken(jwt({ sub: 9 }));
        client.setQueryData(OVERVIEW, calendarsOverviewVariants.available);
        post.release();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedFeedUrl(client)).not.toBe(CALENDAR_FEED_RESET_URL_FIXTURE);
    });

    it('the same viewer (a token refresh mid-POST) gets the new link straight into the cache', async () => {
        const post = holdFeedPost();
        const { client, result } = setup();
        client.setQueryData(OVERVIEW, calendarsOverviewVariants.withFeed);
        act(() => result.current.mutate());
        await waitFor(() => expect(result.current.isPending).toBe(true));
        setAccessToken(jwt({ sub: 1 }, 5));
        post.release();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(cachedFeedUrl(client)).toBe(CALENDAR_FEED_RESET_URL_FIXTURE);
    });
});
