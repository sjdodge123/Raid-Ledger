/**
 * ROK-1893 P3 (Codex P2) — the hub's Open polls list must drop a poll once it
 * stops being open. Cancel, complete and lock-in all invalidate the hub polls
 * key, so a mounted list refetches instead of serving the five-minute cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { createTestQueryClient } from '../../../test/render-helpers';
import { useHubPolls } from './hub-polls-api';
import { useCancelSchedulePoll, useCreateEventFromSlot } from '../../../hooks/use-scheduling';

const fetchApiMock = vi.fn();
const cancelMock = vi.fn();
const fromSlotMock = vi.fn();

vi.mock('../../../lib/api/fetch-api', () => ({
    fetchApi: (...args: unknown[]) => fetchApiMock(...args),
}));

vi.mock('../../../lib/api-client', () => ({
    getSchedulePoll: vi.fn(),
    toggleScheduleVote: vi.fn(),
    suggestSlot: vi.fn(),
    createEventFromSlot: (...args: unknown[]) => fromSlotMock(...args),
    retractAllVotes: vi.fn(),
    getMatchAvailability: vi.fn(),
    getSchedulingBanner: vi.fn(),
    getOtherPolls: vi.fn(),
    cancelSchedulePoll: (...args: unknown[]) => cancelMock(...args),
    remindVoters: vi.fn(),
    addPollMembers: vi.fn(),
}));

/** Mount the hub list and a mutation hook on one client (the list's cache is warm). */
function setup<T>(mutationHook: () => T) {
    const queryClient = createTestQueryClient();
    // The app default: a list stays fresh for five minutes.
    queryClient.setDefaultOptions({ queries: { staleTime: 5 * 60_000, retry: false } });
    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }
    return renderHook(() => ({ polls: useHubPolls(5), mutation: mutationHook() }), { wrapper });
}

describe('hub polls list after a poll stops being open', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchApiMock.mockResolvedValueOnce([{ matchId: 9 }]).mockResolvedValue([]);
        cancelMock.mockResolvedValue({ ok: true });
        fromSlotMock.mockResolvedValue({ eventId: 77 });
    });

    it('a cancel removes the poll from the open list', async () => {
        const { result } = setup(() => useCancelSchedulePoll());
        await waitFor(() => expect(result.current.polls.data).toEqual([{ matchId: 9 }]));
        await act(async () => {
            await result.current.mutation.mutateAsync({ lineupId: 1, matchId: 9 });
        });
        await waitFor(() => expect(result.current.polls.data).toEqual([]));
    });

    it('a lock-in from a slot removes the poll from the open list', async () => {
        const { result } = setup(() => useCreateEventFromSlot());
        await waitFor(() => expect(result.current.polls.data).toEqual([{ matchId: 9 }]));
        await act(async () => {
            await result.current.mutation.mutateAsync({ lineupId: 1, matchId: 9, slotId: 3 });
        });
        await waitFor(() => expect(result.current.polls.data).toEqual([]));
    });
});
