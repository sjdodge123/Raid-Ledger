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

const API_BASE = 'http://localhost:3000';
const COPY_URL = `${API_BASE}/users/me/calendars/events/:eventId`;

vi.mock('./use-auth', () => ({ getAuthToken: () => 'test-token' }));

import { useEventCalendarCopy } from './use-calendar-sync';

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client }, children);
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
});
