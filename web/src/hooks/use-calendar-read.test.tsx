/**
 * ROK-1595 L1 — calendar read-sync hooks: the picker list, read mode (PUT),
 * read on/off + picked calendars (PATCH), and Sync now (202 / 429 / 409).
 * Writes are optimistic and revert on error (D3); every write refetches the
 * overview, the game-time composite, the absences list and scheduling.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import type { CalendarConnection, CalendarsOverview } from '@raid-ledger/contract';
import { server } from '../test/mocks/server';
import { createTestQueryClient } from '../test/render-helpers';
import {
    CALENDAR_CONNECTION_URL, CALENDAR_READ_SETTINGS_URL, CALENDARS_OVERVIEW_URL, calendarErrorResponse, calendarReadErrorHandlers,
    calendarsOverviewFixture, providerCalendarsFixture, readConnectionFixture,
} from '../test/mocks/calendar-sync-handlers';

vi.mock('./use-auth', () => ({ getAuthToken: () => 'test-token' }));

import { CALENDARS_OVERVIEW_KEY } from './use-calendar-sync';
import { GAME_TIME_ABSENCES_KEY, GAME_TIME_QUERY_KEY } from './use-game-time';
import { calendarReadErrorOf } from './calendar-read.helpers';
import { useProviderCalendars, useSetReadCalendars, useSetReadEnabled, useSyncNow, useUpdateReadSettings } from './use-calendar-read';

const READ_OFF: CalendarConnection = { ...readConnectionFixture, read: { enabled: false, calendarIds: [] } };

/** A client seeded with an overview holding one connection (read off unless given). */
function setup(connection: CalendarConnection = READ_OFF) {
    const qc = createTestQueryClient();
    qc.setQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY], calendarsOverviewFixture({ connections: [connection] }));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    return { qc, invalidate, wrapper };
}

const overviewOf = (qc: QueryClient) => qc.getQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY]);

/** The query keys every `invalidateQueries` call named, in call order. */
function invalidatedKeys(spy: ReturnType<typeof setup>['invalidate']): unknown[] {
    return spy.mock.calls.map(([filters]) => filters?.queryKey);
}

const READ_DEPENDENTS = [[...CALENDARS_OVERVIEW_KEY], GAME_TIME_QUERY_KEY, GAME_TIME_ABSENCES_KEY, ['scheduling']];

/** A request gate: the handler waits on `gate` until the spec calls `release()`. */
function holdOpen() {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    return { gate, release };
}

describe('useProviderCalendars', () => {
    it('loads the picker list, including the dedicated calendar for the picker to hide', async () => {
        const { wrapper } = setup();
        const { result } = renderHook(() => useProviderCalendars(7), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(providerCalendarsFixture);
    });

    it('classifies 409 read_scopes as its own state (the grant CTA), not a generic failure', async () => {
        server.use(calendarReadErrorHandlers.calendarsReadScopes());
        const { wrapper } = setup();
        const { result } = renderHook(() => useProviderCalendars(7), { wrapper });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(calendarReadErrorOf(result.current.error)).toBe('read_scopes');
    });

    it('does not fetch while disabled', () => {
        const { wrapper } = setup();
        const { result } = renderHook(() => useProviderCalendars(7, false), { wrapper });
        expect(result.current.fetchStatus).toBe('idle');
    });
});

describe('useUpdateReadSettings', () => {
    it('shows the new mode before the server answers, sends {mode}, and refetches every read dependent', async () => {
        const { gate, release } = holdOpen();
        const bodies: unknown[] = [];
        server.use(http.put(CALENDAR_READ_SETTINGS_URL, async ({ request }) => {
            bodies.push(await request.json());
            await gate;
            return new HttpResponse(null, { status: 204 });
        }));
        const { qc, invalidate, wrapper } = setup();
        const { result } = renderHook(() => useUpdateReadSettings(), { wrapper });
        act(() => result.current.mutate('hours'));
        await waitFor(() => expect(overviewOf(qc)?.readSettings.mode).toBe('hours'));
        expect(result.current.isPending).toBe(true);
        release();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(bodies).toEqual([{ mode: 'hours' }]);
        expect(overviewOf(qc)?.readSettings.mode).toBe('hours');
        expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(READ_DEPENDENTS));
    });

    it('reverts the optimistic mode when the PUT fails', async () => {
        const { gate, release } = holdOpen();
        server.use(http.put(CALENDAR_READ_SETTINGS_URL, async () => {
            await gate;
            return calendarErrorResponse(500, 'Internal server error');
        }));
        const { qc, wrapper } = setup();
        const { result } = renderHook(() => useUpdateReadSettings(), { wrapper });
        act(() => result.current.mutate('days'));
        await waitFor(() => expect(overviewOf(qc)?.readSettings.mode).toBe('days'));
        release();
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(overviewOf(qc)?.readSettings.mode).toBe('both');
        expect(calendarReadErrorOf(result.current.error)).toBe('failed');
    });
});

describe('useSetReadEnabled', () => {
    it('turns read on optimistically, PATCHes {read:{enabled}}, and refetches every read dependent', async () => {
        const { gate, release } = holdOpen();
        const bodies: unknown[] = [];
        server.use(http.patch(CALENDAR_CONNECTION_URL, async ({ request }) => {
            bodies.push(await request.json());
            await gate;
            return new HttpResponse(null, { status: 204 });
        }));
        const { qc, invalidate, wrapper } = setup();
        const { result } = renderHook(() => useSetReadEnabled(), { wrapper });
        act(() => result.current.mutate({ id: READ_OFF.id, enabled: true }));
        await waitFor(() => expect(overviewOf(qc)?.connections[0]?.read.enabled).toBe(true));
        release();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(bodies).toEqual([{ read: { enabled: true } }]);
        expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(READ_DEPENDENTS));
    });

    it('reverts and reports read_scopes when the grant is missing (409)', async () => {
        server.use(calendarReadErrorHandlers.patchReadScopes());
        const { qc, wrapper } = setup();
        const { result } = renderHook(() => useSetReadEnabled(), { wrapper });
        act(() => result.current.mutate({ id: READ_OFF.id, enabled: true }));
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(overviewOf(qc)?.connections[0]?.read.enabled).toBe(false);
        expect(calendarReadErrorOf(result.current.error)).toBe('read_scopes');
    });

    it('leaves other connections untouched', async () => {
        const other: CalendarConnection = { ...READ_OFF, id: 8 };
        const { qc, wrapper } = setup();
        qc.setQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY], calendarsOverviewFixture({ connections: [READ_OFF, other] }));
        const { result } = renderHook(() => useSetReadEnabled(), { wrapper });
        act(() => result.current.mutate({ id: READ_OFF.id, enabled: true }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(overviewOf(qc)?.connections.map((c) => c.read.enabled)).toEqual([true, false]);
    });
});

describe('useSetReadCalendars', () => {
    it('applies the picked ids optimistically and reverts them when the PATCH fails', async () => {
        const { gate, release } = holdOpen();
        server.use(http.patch(CALENDAR_CONNECTION_URL, async () => {
            await gate;
            return calendarErrorResponse(500, 'Internal server error');
        }));
        const { qc, wrapper } = setup(readConnectionFixture);
        const { result } = renderHook(() => useSetReadCalendars(), { wrapper });
        act(() => result.current.mutate({ id: readConnectionFixture.id, calendarIds: ['primary', 'work@group.calendar.google.com'] }));
        await waitFor(() => expect(overviewOf(qc)?.connections[0]?.read.calendarIds).toEqual(['primary', 'work@group.calendar.google.com']));
        expect(overviewOf(qc)?.connections[0]?.read.enabled).toBe(true);
        release();
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(overviewOf(qc)?.connections[0]?.read.calendarIds).toEqual([]);
    });
});

describe('useSyncNow', () => {
    it('202 → queued; refetches every read dependent only once lastSyncedAt advances', async () => {
        let reads = 0;
        const landed: CalendarConnection = { ...readConnectionFixture, lastSyncedAt: '2026-10-12T09:05:00.000Z' };
        server.use(http.get(CALENDARS_OVERVIEW_URL, () => {
            reads += 1;
            return HttpResponse.json(calendarsOverviewFixture({ connections: [reads >= 3 ? landed : readConnectionFixture] }));
        }));
        const { invalidate, wrapper } = setup(readConnectionFixture);
        const { result } = renderHook(() => useSyncNow(1), { wrapper });
        act(() => result.current.mutate(readConnectionFixture.id));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({ outcome: 'queued' });
        await waitFor(() => expect(invalidatedKeys(invalidate)).toEqual(READ_DEPENDENTS));
        // 1 fresh "before" read + landed on the 2nd re-read: not refreshed early, and not only after the cap ran out.
        expect(reads).toBe(3);
    });

    it('202 whose sync never lands: re-reads the overview at most 6 times, then refreshes once', async () => {
        let reads = 0;
        server.use(http.get(CALENDARS_OVERVIEW_URL, () => {
            reads += 1;
            return HttpResponse.json(calendarsOverviewFixture({ connections: [readConnectionFixture] }));
        }));
        const { invalidate, wrapper } = setup(readConnectionFixture);
        const { result } = renderHook(() => useSyncNow(1), { wrapper });
        act(() => result.current.mutate(readConnectionFixture.id));
        await waitFor(() => expect(invalidatedKeys(invalidate)).toEqual(READ_DEPENDENTS));
        expect(reads, '1 fresh "before" read + the 6-read cap').toBe(7);
    });

    it('429 → a throttled result (not an error), with no refetch', async () => {
        server.use(calendarReadErrorHandlers.syncThrottled());
        const { invalidate, wrapper } = setup(readConnectionFixture);
        const { result } = renderHook(() => useSyncNow(), { wrapper });
        act(() => result.current.mutate(readConnectionFixture.id));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({ outcome: 'throttled', retryAfterSeconds: null });
        expect(invalidatedKeys(invalidate)).toEqual([]);
    });

    it('429 carries Retry-After seconds when the server sends the header', async () => {
        server.use(calendarReadErrorHandlers.syncThrottled(240));
        const { wrapper } = setup(readConnectionFixture);
        const { result } = renderHook(() => useSyncNow(), { wrapper });
        act(() => result.current.mutate(readConnectionFixture.id));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({ outcome: 'throttled', retryAfterSeconds: 240 });
    });

    it.each(['read_scopes', 'read_disabled'] as const)('409 %s → an error classified as %s', async (code) => {
        server.use(calendarReadErrorHandlers.syncConflict(code));
        const { wrapper } = setup(readConnectionFixture);
        const { result } = renderHook(() => useSyncNow(), { wrapper });
        act(() => result.current.mutate(readConnectionFixture.id));
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(calendarReadErrorOf(result.current.error)).toBe(code);
    });
});

describe('useSyncNow — the "before" stamp', () => {
    it('a stale cached overview cannot trigger the early refresh: "before" is read fresh', async () => {
        let reads = 0;
        const landed: CalendarConnection = { ...readConnectionFixture, lastSyncedAt: '2026-10-12T09:05:00.000Z' };
        // The server already holds a cron sync (09:00) the cache has never seen (null).
        server.use(http.get(CALENDARS_OVERVIEW_URL, () => {
            reads += 1;
            return HttpResponse.json(calendarsOverviewFixture({ connections: [reads >= 3 ? landed : readConnectionFixture] }));
        }));
        const { invalidate, wrapper } = setup({ ...readConnectionFixture, lastSyncedAt: null });
        const { result } = renderHook(() => useSyncNow(1), { wrapper });
        act(() => result.current.mutate(readConnectionFixture.id));
        await waitFor(() => expect(invalidatedKeys(invalidate)).toEqual(READ_DEPENDENTS));
        expect(reads, 'refreshed only once THIS sync landed (fresh read + 2 re-reads), not on the cron sync').toBe(3);
    });
});
