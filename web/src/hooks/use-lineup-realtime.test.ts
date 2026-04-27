/**
 * useLineupRealtime hook tests (ROK-1118).
 *
 * TDD gate: the hook does not exist yet. Importing it must fail until the
 * dev agent creates `web/src/hooks/use-lineup-realtime.ts`.
 *
 * Behaviors covered:
 *   1. When the underlying socket emits `lineup:status`, the hook invalidates
 *      the React Query detail key `['lineups', 'detail', lineupId]`.
 *   2. The hook subscribes on mount (`emit('lineup:subscribe', { lineupId })`)
 *      and unsubscribes on unmount (`emit('lineup:unsubscribe', { lineupId })`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// --- Socket mock ----------------------------------------------------------
//
// We capture every socket.io callback the hook registers via `on(event, cb)`
// in `socketHandlers` so the test can fire events synthetically.

type Handler = (...args: unknown[]) => void;

const socketHandlers = new Map<string, Handler>();
const mockEmit = vi.fn();
const mockOn = vi.fn((event: string, cb: Handler) => {
    socketHandlers.set(event, cb);
});
const mockOff = vi.fn((event: string) => {
    socketHandlers.delete(event);
});
const mockDisconnect = vi.fn();

const mockSocket = {
    emit: mockEmit,
    on: mockOn,
    off: mockOff,
    disconnect: mockDisconnect,
    connected: true,
};

// `socket.io-client` is the real package the hook will pull in. We mock
// `io(...)` to return the controllable socket above.
const mockIo = vi.fn(() => mockSocket);
vi.mock('socket.io-client', () => ({
    io: (...args: unknown[]) => mockIo(...args),
    Socket: class {},
}));

// --- Test harness ---------------------------------------------------------

function createTestHarness() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
            mutations: { retry: false },
        },
    });

    // Seed the cache so invalidation has a target to act on.
    queryClient.setQueryData(['lineups', 'detail', 42], { id: 42, status: 'voting' });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    return { queryClient, invalidateSpy, wrapper };
}

/** Fire a captured socket event with the given payload. */
function fireSocketEvent(event: string, payload: unknown) {
    const handler = socketHandlers.get(event);
    if (!handler) {
        throw new Error(`No handler registered for ${event}`);
    }
    handler(payload);
}

// --- Tests ----------------------------------------------------------------

describe('useLineupRealtime (ROK-1118)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        socketHandlers.clear();
    });

    it('invalidates the lineup detail query when socket emits lineup:status', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();

        // Import inside the test so the vi.mock for 'socket.io-client' is
        // already in effect. Importing at top level before the hook exists
        // would explode the whole file.
        const mod = await import('./use-lineup-realtime');
        const useLineupRealtime = mod.useLineupRealtime;

        renderHook(() => useLineupRealtime(42), { wrapper });

        // Hook should have registered a 'lineup:status' handler with the
        // socket. Fire it synthetically to simulate a server broadcast.
        await act(async () => {
            fireSocketEvent('lineup:status', {
                lineupId: 42,
                status: 'decided',
                statusChangedAt: new Date().toISOString(),
            });
        });

        // The detail query for this lineup must be invalidated so React
        // Query refetches the new phase.
        const detailCalls = invalidateSpy.mock.calls.filter(
            ([opts]) =>
                JSON.stringify(opts?.queryKey) ===
                JSON.stringify(['lineups', 'detail', 42]),
        );
        expect(detailCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('subscribes on mount and unsubscribes on unmount', async () => {
        const { wrapper } = createTestHarness();

        const mod = await import('./use-lineup-realtime');
        const useLineupRealtime = mod.useLineupRealtime;

        const { unmount } = renderHook(() => useLineupRealtime(42), { wrapper });

        // After mount the hook should have emitted 'lineup:subscribe' once.
        const subscribeCalls = mockEmit.mock.calls.filter(
            ([event]) => event === 'lineup:subscribe',
        );
        expect(subscribeCalls).toHaveLength(1);
        expect(subscribeCalls[0][1]).toEqual({ lineupId: 42 });

        // After unmount the hook should emit 'lineup:unsubscribe'.
        unmount();

        const unsubscribeCalls = mockEmit.mock.calls.filter(
            ([event]) => event === 'lineup:unsubscribe',
        );
        expect(unsubscribeCalls).toHaveLength(1);
        expect(unsubscribeCalls[0][1]).toEqual({ lineupId: 42 });
    });
});
