/**
 * ROK-1596 W2/W3 — `useEventCalendarCopy` reads the server's null (an EMPTY
 * 200 body from Nest) as "no copy" instead of throwing on `response.json()`.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { calendarsOverviewVariants } from '../test/mocks/calendar-sync-handlers';

const API_BASE = 'http://localhost:3000';
const COPY_URL = `${API_BASE}/users/me/calendars/events/:eventId`;

vi.mock('./use-auth', () => ({ getAuthToken: () => 'test-token' }));
vi.mock('../lib/api-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/api-client')>()),
    signupForEvent: vi.fn(async () => ({})),
    cancelSignup: vi.fn(async () => undefined),
}));

import {
    COPY_POLL_MAX_MS, COPY_POLL_MS, copyPollInterval, useCalendarsOverview, useEventCalendarCopy, useUpdateConnection,
} from './use-calendar-sync';
import { useCancelSignup, useSignup } from './use-signups';

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client }, children);
}

const PENDING = { provider: 'google', state: 'pending', openUrl: null };
const SYNCED = { provider: 'google', state: 'synced', openUrl: 'https://www.google.com/calendar/event?eid=x' };

/** Serves each body in turn (the last one repeats) and counts the GETs. */
function serveSequence(...bodies: Array<Record<string, unknown> | null>) {
    const calls = { n: 0 };
    server.use(http.get(COPY_URL, () => HttpResponse.json(bodies[Math.min(calls.n++, bodies.length - 1)])));
    return calls;
}

describe('useEventCalendarCopy', () => {
    it('treats an empty 200 body as null (no copy) without erroring', async () => {
        server.use(http.get(COPY_URL, () => new HttpResponse(null, { status: 200 })));
        const { result } = renderHook(() => useEventCalendarCopy(7), { wrapper });
        await waitFor(() => expect(result.current.isFetched).toBe(true));
        expect(result.current.error).toBeNull();
        expect(result.current.data).toBeNull();
    });

    it('parses a synced copy', async () => {
        const copy = { provider: 'google', state: 'synced', openUrl: 'https://www.google.com/calendar/event?eid=x' };
        server.use(http.get(COPY_URL, () => HttpResponse.json(copy)));
        const { result } = renderHook(() => useEventCalendarCopy(7), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(copy);
    });

    it('surfaces a non-2xx as an error', async () => {
        server.use(http.get(COPY_URL, () => new HttpResponse(null, { status: 500 })));
        const { result } = renderHook(() => useEventCalendarCopy(7), { wrapper });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error?.message).toBe('HTTP 500');
    });

    it('re-reads a pending copy until it is synced (MAJOR 2: the line no longer sticks on "Adding…")', async () => {
        const calls = serveSequence(PENDING, SYNCED);
        const { result } = renderHook(() => useEventCalendarCopy(7), { wrapper });
        await waitFor(() => expect(result.current.data?.state).toBe('pending'));
        await waitFor(() => expect(result.current.data?.state).toBe('synced'), { timeout: COPY_POLL_MS + 2_000 });
        expect(calls.n).toBe(2);
    });
});

describe('copyPollInterval', () => {
    it('polls only while pending, and stops after the cap', () => {
        expect(copyPollInterval('pending', 1_000, 1_000)).toBe(COPY_POLL_MS);
        expect(copyPollInterval('pending', 1_000, 1_000 + COPY_POLL_MAX_MS - 1)).toBe(COPY_POLL_MS);
        expect(copyPollInterval('pending', 1_000, 1_000 + COPY_POLL_MAX_MS)).toBe(false);
        for (const s of ['synced', 'failed', 'suppressed', undefined] as const) expect(copyPollInterval(s, 1_000, 1_000)).toBe(false);
    });
});

describe('sign-up / cancel invalidate the copy', () => {
    it.each([
        ['sign-up', useSignup],
        ['cancel', useCancelSignup],
    ] as const)('%s success re-reads the event copy', async (_name, useMutationHook) => {
        const calls = serveSequence(null, SYNCED);
        const { result } = renderHook(() => ({ copy: useEventCalendarCopy(7), m: useMutationHook(7) }), { wrapper });
        await waitFor(() => expect(result.current.copy.isFetched).toBe(true));
        expect(calls.n).toBe(1);
        await result.current.m.mutateAsync(undefined as never);
        await waitFor(() => expect(result.current.copy.data?.state).toBe('synced'));
        expect(calls.n).toBe(2);
    });
});

describe('useUpdateConnection', () => {
    it('stays pending until the overview refetch lands, so a saved control never snaps back to the stale value', async () => {
        let releaseRefetch: () => void = () => {};
        let gets = 0;
        server.use(
            http.patch(`${API_BASE}/users/me/calendars/:id`, () => new HttpResponse(null, { status: 204 })),
            http.get(`${API_BASE}/users/me/calendars`, async () => {
                gets += 1;
                if (gets > 1) await new Promise<void>((resolve) => { releaseRefetch = resolve; });
                return HttpResponse.json(calendarsOverviewVariants.connected);
            }),
        );
        const { result } = renderHook(() => ({ overview: useCalendarsOverview(), update: useUpdateConnection() }), { wrapper });
        await waitFor(() => expect(result.current.overview.isSuccess).toBe(true));
        result.current.update.mutate({ id: 7, body: { write: { target: 'dedicated' } } });
        await waitFor(() => expect(gets, 'the PATCH success should trigger the overview refetch').toBe(2));
        expect(result.current.update.isPending, 'mutation settled before the refetch landed').toBe(true);
        releaseRefetch();
        await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    });
});
