/**
 * ROK-1464 AC6 — the Find-a-time write path (D3/D4).
 *
 * The three calls are NOT atomic: the poll exists the moment `create` returns,
 * so a later failure must never leave the viewer without a link to it. These
 * tests pin the order and both failure stories.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const calls: string[] = [];
const navigate = vi.fn();

const createSchedulingPoll = vi.fn();
const suggestSlot = vi.fn();
const convertIntents = vi.fn();
const createIntent = vi.fn();
const withdrawIntent = vi.fn();

vi.mock('../lib/api-client', () => ({
    createSchedulingPoll: (...args: unknown[]) => {
        calls.push('create');
        return createSchedulingPoll(...args);
    },
    suggestSlot: (...args: unknown[]) => {
        calls.push('suggest');
        return suggestSlot(...args);
    },
}));

// D8: the LFG client is its own module (shared with ROK-1453).
vi.mock('../lib/api/lfg-api', () => ({
    convertIntents: (...args: unknown[]) => {
        calls.push('convert');
        return convertIntents(...args);
    },
    createIntent: (...args: unknown[]) => createIntent(...args),
    withdrawIntent: (...args: unknown[]) => withdrawIntent(...args),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const toastError = vi.fn();
vi.mock('../lib/toast', () => ({
    toast: { error: (m: string) => toastError(m), success: vi.fn() },
}));

import { useFindATime, useWithdraw } from './use-lfg-actions';
// ROK-1453 owns the join mutation; the invalidation case follows it there.
import { useJoinGroup } from './use-lfg-join';

const POLL = { id: 55, lineupId: 9 };

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    return createElement(QueryClientProvider, { client }, children);
}

/** A wrapper whose client can be watched for cache invalidation. */
function makeWatchedWrapper() {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const watched = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
    return { wrapper: watched, invalidate };
}

beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    createSchedulingPoll.mockResolvedValue(POLL);
    suggestSlot.mockResolvedValue({ id: 1 });
    convertIntents.mockResolvedValue({ converted: 2 });
});

describe('useFindATime', () => {
    it('creates the poll, seeds the slot, converts, then navigates', async () => {
        const { result } = renderHook(() => useFindATime(), { wrapper });

        act(() => {
            result.current.findATime({
                gameId: 7,
                memberUserIds: [1, 2, 3],
                proposedTime: '2026-09-02T19:00:00.000+02:00',
            });
        });

        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(calls).toEqual(['create', 'suggest', 'convert']);
        expect(createSchedulingPoll).toHaveBeenCalledWith({
            gameId: 7,
            memberUserIds: [1, 2, 3],
            durationHours: 2,
            minVoteThreshold: 3,
        });
        expect(suggestSlot).toHaveBeenCalledWith(
            9,
            55,
            '2026-09-02T19:00:00.000+02:00',
        );
        expect(convertIntents).toHaveBeenCalledWith(7, { pollId: 55 });
        expect(navigate).toHaveBeenCalledWith(
            '/community-lineup/9/schedule/55',
        );
    });

    it('skips the slot seed when no window was picked', async () => {
        const { result } = renderHook(() => useFindATime(), { wrapper });

        act(() => {
            result.current.findATime({ gameId: 7, memberUserIds: [1] });
        });

        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(calls).toEqual(['create', 'convert']);
        expect(suggestSlot).not.toHaveBeenCalled();
    });
});

describe('useFindATime — failure stories', () => {
    it('treats a failed slot seed as non-fatal and still converts', async () => {
        suggestSlot.mockRejectedValue(new Error('slot rejected'));
        const { result } = renderHook(() => useFindATime(), { wrapper });

        act(() => {
            result.current.findATime({
                gameId: 7,
                memberUserIds: [1, 2],
                proposedTime: '2026-09-02T19:00:00.000+02:00',
            });
        });

        await waitFor(() => expect(navigate).toHaveBeenCalled());
        expect(calls).toEqual(['create', 'suggest', 'convert']);
        expect(toastError).toHaveBeenCalledWith(
            expect.stringContaining('not pre-filled'),
        );
    });

    it('keeps the poll link and offers a retry when convert fails', async () => {
        convertIntents.mockRejectedValueOnce(new Error('convert boom'));
        const { result } = renderHook(() => useFindATime(), { wrapper });

        act(() => {
            result.current.findATime({ gameId: 7, memberUserIds: [1, 2] });
        });

        await waitFor(() =>
            expect(result.current.pendingConvert).toEqual({
                gameId: 7,
                lineupId: 9,
                matchId: 55,
            }),
        );
        expect(navigate).not.toHaveBeenCalled();
        expect(toastError).toHaveBeenCalledWith(
            'Poll created, but the group could not be marked as scheduled',
        );

        await act(async () => {
            await result.current.retryConvert();
        });

        expect(convertIntents).toHaveBeenCalledTimes(2);
        expect(navigate).toHaveBeenCalledWith(
            '/community-lineup/9/schedule/55',
        );
        expect(result.current.pendingConvert).toBeNull();
    });
});

describe('useJoinGroup / useWithdraw', () => {
    it('invalidates the whole lfg namespace after a +1', async () => {
        createIntent.mockResolvedValue({ id: 1 });
        const { wrapper: watched, invalidate } = makeWatchedWrapper();
        const { result } = renderHook(() => useJoinGroup(), {
            wrapper: watched,
        });

        act(() => result.current.mutate(7));

        await waitFor(() => expect(createIntent).toHaveBeenCalledWith(7));
        await waitFor(() =>
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lfg'] }),
        );
    });

    it('invalidates the whole lfg namespace after a withdraw', async () => {
        withdrawIntent.mockResolvedValue(undefined);
        const { wrapper: watched, invalidate } = makeWatchedWrapper();
        const { result } = renderHook(() => useWithdraw(), {
            wrapper: watched,
        });

        act(() => result.current.mutate(7));

        await waitFor(() => expect(withdrawIntent).toHaveBeenCalledWith(7));
        await waitFor(() =>
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['lfg'] }),
        );
    });
});
