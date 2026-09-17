/**
 * ROK-1573 — "Lock in this event" posts one `POST /events` carrying
 * `lfgGameId`, invalidates the reads the event-set state depends on, and
 * toasts a failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const createEvent = vi.fn();
vi.mock('../lib/api/events-api', () => ({
    createEvent: (...args: unknown[]) => createEvent(...args),
}));

const toastError = vi.fn();
vi.mock('../lib/toast', () => ({
    toast: { error: (m: string) => toastError(m), success: vi.fn() },
}));

import { useLockInEvent } from './use-lfg-lock-in';

const WINDOW = {
    start: '2026-09-23T01:00:00.000Z',
    end: '2026-09-23T03:00:00.000Z',
};

function setup() {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => useLockInEvent(42, 'Valheim'), { wrapper });
    return { hook, invalidate };
}

describe('useLockInEvent', () => {
    beforeEach(() => {
        createEvent.mockReset();
        toastError.mockReset();
    });

    it('posts a short window unchanged as an event converting the group', async () => {
        createEvent.mockResolvedValue({ id: 7 });
        const onSuccess = vi.fn();
        const { hook } = setup();

        act(() => hook.result.current.lockIn(WINDOW, { onSuccess }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalled());
        expect(createEvent).toHaveBeenCalledWith({
            gameId: 42,
            lfgGameId: 42,
            title: 'Valheim',
            startTime: WINDOW.start,
            endTime: WINDOW.end,
        });
        expect(onSuccess.mock.calls[0][0]).toEqual({ id: 7 });
    });

    it('caps a 7-hour window at 3 hours from its start', async () => {
        createEvent.mockResolvedValue({ id: 7 });
        const { hook } = setup();

        act(() => hook.result.current.lockIn({
            start: '2026-09-23T01:00:00.000Z',
            end: '2026-09-23T08:00:00.000Z',
        }));

        await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
        expect(createEvent.mock.calls[0][0]).toMatchObject({
            startTime: '2026-09-23T01:00:00.000Z',
            endTime: '2026-09-23T04:00:00.000Z',
        });
    });

    it('invalidates every LFG read (board, chips, history, group, overlap) and events', async () => {
        createEvent.mockResolvedValue({ id: 7 });
        const { hook, invalidate } = setup();

        act(() => hook.result.current.lockIn(WINDOW));

        await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
        const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
        expect(keys).toEqual([['lfg'], ['events']]);
    });

    it('toasts the server message on failure and invalidates nothing', async () => {
        createEvent.mockRejectedValue(new Error('Start time must be in the future'));
        const { hook, invalidate } = setup();

        act(() => hook.result.current.lockIn(WINDOW));

        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith('Start time must be in the future'),
        );
        expect(invalidate).not.toHaveBeenCalled();
        expect(hook.result.current.isPending).toBe(false);
    });

    it('falls back to the lock-in copy when the error has no message', async () => {
        createEvent.mockRejectedValue(new Error(''));
        const { hook } = setup();

        act(() => hook.result.current.lockIn(WINDOW));

        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith('Could not create the event'),
        );
    });
});
