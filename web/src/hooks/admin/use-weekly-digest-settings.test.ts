/** ROK-1435 (L5): the weekly digest settings hook — GET, full PUT, cache update. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';

const API_BASE = 'http://localhost:3000';
const URL = `${API_BASE}/admin/settings/discord-bot/weekly-digest`;
const getAuthTokenMock = vi.fn<[], string | null>();

vi.mock('../use-auth', async () => {
    const actual = await vi.importActual<typeof import('../use-auth')>('../use-auth');
    return { ...actual, getAuthToken: () => getAuthTokenMock() };
});

import { useWeeklyDigestSettings, WEEKLY_DIGEST_KEY } from './use-weekly-digest-settings';

const STORED = { enabled: false, channelId: null, day: 1, hour: 9, timezone: 'UTC' };

function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    return { queryClient, ...renderHook(() => useWeeklyDigestSettings(), { wrapper }) };
}

describe('useWeeklyDigestSettings (ROK-1435 L5)', () => {
    const puts: unknown[] = [];

    beforeEach(() => {
        puts.length = 0;
        getAuthTokenMock.mockReturnValue('test-token');
        server.use(
            http.get(URL, () => HttpResponse.json(STORED)),
            http.get(`${API_BASE}/admin/settings/discord-bot/channels`, () =>
                HttpResponse.json([{ id: 'c1', name: 'general' }])),
            http.put(URL, async ({ request }) => {
                const body = (await request.json()) as Record<string, unknown>;
                puts.push(body);
                return HttpResponse.json({ ...body, timezone: 'UTC' });
            }),
        );
    });

    it('loads the settings and the channel list', async () => {
        const { result } = setup();
        await waitFor(() => expect(result.current.status.data).toEqual(STORED));
        await waitFor(() => expect(result.current.channels.data).toEqual([{ id: 'c1', name: 'general' }]));
    });

    it('does not fetch without an auth token', () => {
        getAuthTokenMock.mockReturnValue(null);
        const { result } = setup();
        expect(result.current.status.fetchStatus).toBe('idle');
    });

    it('PUTs the whole settings object and writes the response into the cache', async () => {
        const { result, queryClient } = setup();
        await waitFor(() => expect(result.current.status.data).toBeDefined());
        const next = { enabled: true, channelId: 'c1', day: 5 as const, hour: 20 };
        await act(() => result.current.update.mutateAsync(next));
        expect(puts).toEqual([next]);
        expect(queryClient.getQueryData([...WEEKLY_DIGEST_KEY])).toEqual({ ...next, timezone: 'UTC' });
    });

    it('surfaces a failed PUT as a mutation error', async () => {
        server.use(http.put(URL, () => HttpResponse.json({ message: 'Validation failed' }, { status: 400 })));
        const { result } = setup();
        await expect(
            act(() => result.current.update.mutateAsync({ ...STORED, enabled: true, day: 1 })),
        ).rejects.toThrow();
        await waitFor(() => expect(result.current.update.isError).toBe(true));
    });
});
