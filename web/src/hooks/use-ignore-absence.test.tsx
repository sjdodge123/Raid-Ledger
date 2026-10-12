/**
 * ROK-1595 L1 — `useIgnoreAbsence`: POST `/me/game-time/absences/:id/ignore`
 * hides the synced row at once, restores it when the server refuses (409
 * `not_calendar`, 404), and refetches game time, the absences list and
 * scheduling either way.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import type { GameTimeAbsence } from '@raid-ledger/contract';
import { server } from '../test/mocks/server';
import { createTestQueryClient } from '../test/render-helpers';
import {
    ABSENCE_IGNORE_URL, absenceIgnoreErrorHandlers, calendarAbsenceFixture, manualAbsenceFixture,
} from '../test/mocks/game-time-calendar-handlers';
import { httpStatusOf } from '../lib/api/api-error';

vi.mock('./use-auth', () => ({ getAuthToken: () => 'test-token' }));

import { GAME_TIME_ABSENCES_KEY, GAME_TIME_QUERY_KEY, useIgnoreAbsence } from './use-game-time';

function setup() {
    const qc = createTestQueryClient();
    qc.setQueryData<GameTimeAbsence[]>(GAME_TIME_ABSENCES_KEY, [manualAbsenceFixture, calendarAbsenceFixture]);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useIgnoreAbsence(), { wrapper });
    const absenceIds = () => qc.getQueryData<GameTimeAbsence[]>(GAME_TIME_ABSENCES_KEY)?.map((a) => a.id);
    return { invalidate, result, absenceIds };
}

describe('useIgnoreAbsence', () => {
    it('hides the synced row before the server answers, posts to its id, and refetches game time + absences + scheduling', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const ids: unknown[] = [];
        server.use(http.post(ABSENCE_IGNORE_URL, async ({ params }) => {
            ids.push(params['id']);
            await gate;
            return new HttpResponse(null, { status: 204 });
        }));
        const { invalidate, result, absenceIds } = setup();
        act(() => result.current.mutate(calendarAbsenceFixture.id));
        await waitFor(() => expect(absenceIds()).toEqual([manualAbsenceFixture.id]));
        release();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(ids).toEqual([String(calendarAbsenceFixture.id)]);
        expect(absenceIds()).toEqual([manualAbsenceFixture.id]);
        const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
        expect(keys).toEqual(expect.arrayContaining([GAME_TIME_QUERY_KEY, GAME_TIME_ABSENCES_KEY, ['scheduling']]));
    });

    it('succeeds against the default (global) 204 handler', async () => {
        const { result } = setup();
        act(() => result.current.mutate(calendarAbsenceFixture.id));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('restores the row and surfaces 409 not_calendar for a manual absence', async () => {
        server.use(absenceIgnoreErrorHandlers.notCalendar());
        const { result, absenceIds } = setup();
        act(() => result.current.mutate(manualAbsenceFixture.id));
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(absenceIds()).toEqual([manualAbsenceFixture.id, calendarAbsenceFixture.id]);
        expect(httpStatusOf(result.current.error)).toBe(409);
        expect(result.current.error?.message).toBe('not_calendar');
    });

    it('restores the row and surfaces 404 for a missing absence', async () => {
        server.use(absenceIgnoreErrorHandlers.notFound());
        const { result, absenceIds } = setup();
        act(() => result.current.mutate(calendarAbsenceFixture.id));
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(absenceIds()).toEqual([manualAbsenceFixture.id, calendarAbsenceFixture.id]);
        expect(httpStatusOf(result.current.error)).toBe(404);
    });
});
