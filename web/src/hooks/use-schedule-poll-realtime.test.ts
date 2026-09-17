/**
 * Live scheduling-poll votes (ROK-1551, S2-AC1..AC3).
 *
 * Covers the socket subscription + invalidation gating of
 * `useSchedulePollRealtime`, the fallback `refetchInterval` rule, and the
 * vote mutation's `mutationKey` the handler's in-flight guard depends on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';

type Handler = (...args: unknown[]) => void;

const handlers = new Map<string, Handler[]>();
const mockEmit = vi.fn();
const mockOn = vi.fn((event: string, cb: Handler) => {
    handlers.set(event, [...(handlers.get(event) ?? []), cb]);
});
const mockOff = vi.fn((event: string, cb: Handler) => {
    handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== cb));
});
const mockDisconnect = vi.fn();
const mockSocket = {
    emit: mockEmit, on: mockOn, off: mockOff, disconnect: mockDisconnect, connected: false,
};
const mockIo = vi.fn(() => mockSocket);
vi.mock('socket.io-client', () => ({
    io: (...args: unknown[]) => mockIo(...args),
    Socket: class {},
}));

vi.mock('../lib/api-client', () => ({
    toggleScheduleVote: vi.fn(() => new Promise(() => undefined)),
}));

import {
    useSchedulePollRealtime,
    liveRefetchInterval,
    LIVE_FALLBACK_INTERVAL_MS,
} from './use-schedule-poll-realtime';
import { useToggleScheduleVote, SCHEDULE_VOTE_MUTATION_KEY } from './use-scheduling';

const POLL_KEY = ['scheduling', 'poll', 42, 7];
const PARTICIPANTS = ['lineups', 'participants', 42, 7];

function fire(event: string, payload?: unknown): void {
    for (const h of handlers.get(event) ?? []) h(payload);
}

function harness() {
    const qc = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: qc }, children);
    return { qc, spy, wrapper };
}

function keys(spy: ReturnType<typeof vi.spyOn>): string[] {
    return spy.mock.calls.map(([opts]) => JSON.stringify((opts as { queryKey: unknown }).queryKey));
}

function setVisibility(state: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('useSchedulePollRealtime — subscription (ROK-1551)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        handlers.clear();
        mockSocket.connected = false;
        setVisibility('visible');
    });

    it('opens no socket for a poll that is not open', () => {
        const { wrapper } = harness();
        const { result } = renderHook(() => useSchedulePollRealtime(42, 7, false), { wrapper });
        expect(mockIo).not.toHaveBeenCalled();
        expect(result.current.connected).toBe(false);
    });

    it('subscribes to the lineup room for an open poll and tracks connection', () => {
        const { wrapper } = harness();
        const { result } = renderHook(() => useSchedulePollRealtime(42, 7, true), { wrapper });
        expect(result.current.connected).toBe(false);
        act(() => { fire('connect'); });
        expect(mockEmit).toHaveBeenCalledWith('subscribe', { lineupId: 42 });
        expect(result.current.connected).toBe(true);
        act(() => { fire('disconnect'); });
        expect(result.current.connected).toBe(false);
    });
});

describe('useSchedulePollRealtime — event gating (ROK-1551)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        handlers.clear();
        mockSocket.connected = false;
        setVisibility('visible');
    });

    it('ignores an event for another match', () => {
        const { spy, wrapper } = harness();
        renderHook(() => useSchedulePollRealtime(42, 7, true), { wrapper });
        act(() => { fire('lineup:schedule-changed', { lineupId: 42, matchId: 99 }); });
        expect(spy).not.toHaveBeenCalled();
    });

    it('invalidates the poll and its participants when visible', () => {
        const { spy, wrapper } = harness();
        renderHook(() => useSchedulePollRealtime(42, 7, true), { wrapper });
        act(() => { fire('lineup:schedule-changed', { lineupId: 42, matchId: 7 }); });
        expect(keys(spy)).toEqual([JSON.stringify(POLL_KEY), JSON.stringify(PARTICIPANTS)]);
        for (const [opts] of spy.mock.calls) {
            expect((opts as { refetchType?: string }).refetchType).toBeUndefined();
        }
    });

    it('only marks stale (refetchType none) while the tab is hidden', () => {
        setVisibility('hidden');
        const { spy, wrapper } = harness();
        renderHook(() => useSchedulePollRealtime(42, 7, true), { wrapper });
        act(() => { fire('lineup:schedule-changed', { lineupId: 42, matchId: 7 }); });
        expect(keys(spy)).toContain(JSON.stringify(POLL_KEY));
        for (const [opts] of spy.mock.calls) {
            expect((opts as { refetchType?: string }).refetchType).toBe('none');
        }
    });

    it('skips invalidation while a vote mutation is in flight', async () => {
        const { qc, spy, wrapper } = harness();
        const { result } = renderHook(() => {
            useSchedulePollRealtime(42, 7, true);
            return useToggleScheduleVote();
        }, { wrapper });
        await act(async () => { result.current.mutate({ lineupId: 42, matchId: 7, slotId: 1 }); });
        expect(qc.isMutating({ mutationKey: [...SCHEDULE_VOTE_MUTATION_KEY] })).toBe(1);
        spy.mockClear();
        act(() => { fire('lineup:schedule-changed', { lineupId: 42, matchId: 7 }); });
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('useSchedulePollRealtime — teardown (ROK-1551)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        handlers.clear();
        mockSocket.connected = false;
    });

    it('unsubscribes, removes listeners and disconnects on unmount', () => {
        const { wrapper } = harness();
        const { unmount } = renderHook(() => useSchedulePollRealtime(42, 7, true), { wrapper });
        unmount();
        expect(mockEmit).toHaveBeenCalledWith('unsubscribe', { lineupId: 42 });
        expect(mockOff).toHaveBeenCalledWith('lineup:schedule-changed', expect.any(Function));
        expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('tears the socket down when the poll stops being open', () => {
        const { wrapper } = harness();
        const { rerender, result } = renderHook(
            ({ open }) => useSchedulePollRealtime(42, 7, open),
            { wrapper, initialProps: { open: true } },
        );
        act(() => { fire('connect'); });
        rerender({ open: false });
        expect(mockDisconnect).toHaveBeenCalledTimes(1);
        expect(result.current.connected).toBe(false);
    });
});

describe('liveRefetchInterval (ROK-1551 fallback)', () => {
    const poll = (pollStatus: SchedulePollPageResponseDto['pollStatus']) =>
        ({ pollStatus }) as SchedulePollPageResponseDto;

    it('polls every 10s only when the poll is open AND the socket is down', () => {
        expect(LIVE_FALLBACK_INTERVAL_MS).toBe(10_000);
        expect(liveRefetchInterval(poll('open'), false)).toBe(10_000);
        expect(liveRefetchInterval(poll('open'), true)).toBe(false);
    });

    it.each(['locked_in', 'cancelled', 'closed'] as const)('never polls a %s poll', (status) => {
        expect(liveRefetchInterval(poll(status), false)).toBe(false);
    });

    it('does not poll before the first response', () => {
        expect(liveRefetchInterval(undefined, false)).toBe(false);
    });
});
