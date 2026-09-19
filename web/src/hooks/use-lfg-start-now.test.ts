/**
 * ROK-1613 — `useStartNow`, the on-demand session mutation.
 *
 * The page tests mock this hook, and the smoke spec only drives the happy
 * path, so without these the three things the hook exists to guarantee are
 * unasserted: that a refusal still closes the confirm, that the toast fires,
 * and that the reads invalidated are the ones the page actually renders from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('../lib/api/lfg-api', () => ({ startNowSession: vi.fn() }));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { startNowSession } from '../lib/api/lfg-api';
import { toast } from '../lib/toast';
import { useStartNow } from './use-lfg-start-now';

const mockStartNow = vi.mocked(startNowSession);
const GAME_ID = 7;

function harness() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useStartNow(GAME_ID), { wrapper });
    return { result, invalidate };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useStartNow', () => {
    it('posts for the game it was given', async () => {
        mockStartNow.mockResolvedValue({ eventId: 42, spawned: true, invited: 2 });
        const { result } = harness();

        result.current.startNow();

        await waitFor(() => expect(mockStartNow).toHaveBeenCalledWith(GAME_ID));
    });

    /**
     * The page reads `playingNow` off the `['lfg']` detail to flip into the
     * session state, and the ad-hoc event is new on the calendar. Invalidating
     * anything else leaves the user looking at a group that has already
     * started — the failure a key rename would otherwise pass silently.
     */
    it('invalidates BOTH the lfg reads and the events reads', async () => {
        mockStartNow.mockResolvedValue({ eventId: 42, spawned: true, invited: 0 });
        const { result, invalidate } = harness();

        result.current.startNow();

        await waitFor(() =>
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lfg'] }),
        );
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['events'] });
    });

    /** AC5 — attaching to a live session is a SUCCESS, not a failure. */
    it('treats spawned:false as success and still refreshes the reads', async () => {
        mockStartNow.mockResolvedValue({ eventId: 9, spawned: false, invited: 0 });
        const { result, invalidate } = harness();

        result.current.startNow();

        await waitFor(() =>
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lfg'] }),
        );
        expect(toast.error).not.toHaveBeenCalled();
    });

    /**
     * AC6's 403. `onSettled` rather than `onSuccess` is the whole reason the
     * confirm closes on a refusal; with `onSuccess` the dialog would keep a
     * spinner up over a request that already finished.
     */
    it('runs the caller callback on a REFUSAL, not just on success', async () => {
        mockStartNow.mockRejectedValue(new Error('+1 first — you have to be in the group to start it'));
        const { result } = harness();
        const done = vi.fn();

        result.current.startNow({ onSettled: done });

        await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    });

    it('surfaces the server message on a refusal', async () => {
        mockStartNow.mockRejectedValue(new Error('+1 first — you have to be in the group to start it'));
        const { result } = harness();

        result.current.startNow();

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(
                '+1 first — you have to be in the group to start it',
            ),
        );
    });

    it('falls back to its own copy when the error carries no message', async () => {
        mockStartNow.mockRejectedValue(new Error(''));
        const { result } = harness();

        result.current.startNow();

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith('Could not start the session'),
        );
    });
});
