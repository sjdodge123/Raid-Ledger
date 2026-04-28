/**
 * useLineupRealtime hook tests (ROK-1118).
 *
 * TDD gate: the hook does not exist yet. Importing it must fail until the
 * dev agent creates `web/src/hooks/use-lineup-realtime.ts`.
 *
 * Behaviors covered:
 *   1. When the underlying socket emits `lineup:status`, the hook invalidates
 *      the React Query detail key `['lineups', 'detail', lineupId]`.
 *   2. The hook subscribes on mount (`emit('subscribe', { lineupId })`)
 *      and unsubscribes on unmount (`emit('unsubscribe', { lineupId })`).
 *
 * Note: Phase A contract (`LineupRealtimeEventNames`) and Phase C gateway
 * (`@SubscribeMessage('subscribe')`) use bare client→server names per the
 * architect correction. The earlier draft of this test asserted on the
 * `lineup:`-prefixed names, which would never be matched by the server.
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

        // After mount the hook should have emitted 'subscribe' once.
        const subscribeCalls = mockEmit.mock.calls.filter(
            ([event]) => event === 'subscribe',
        );
        expect(subscribeCalls).toHaveLength(1);
        expect(subscribeCalls[0][1]).toEqual({ lineupId: 42 });

        // After unmount the hook should emit 'unsubscribe'.
        unmount();

        const unsubscribeCalls = mockEmit.mock.calls.filter(
            ([event]) => event === 'unsubscribe',
        );
        expect(unsubscribeCalls).toHaveLength(1);
        expect(unsubscribeCalls[0][1]).toEqual({ lineupId: 42 });
    });
});

// ─── ROK-1117: tiebreaker-open event ─────────────────────────────────────
//
// When the gateway emits `lineup:tiebreaker:open`, the hook must invalidate
// the tiebreaker detail query (`['tiebreaker', lineupId]`) so that any UI
// using `useTiebreakerDetail` re-fetches and the late-join voting form
// becomes visible without a manual reload.

describe('useLineupRealtime — tiebreaker:open (ROK-1117)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        socketHandlers.clear();
    });

    it('invalidates the tiebreaker detail query on lineup:tiebreaker:open', async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
                mutations: { retry: false },
            },
        });
        // Seed the tiebreaker cache so invalidation has a target.
        queryClient.setQueryData(['tiebreaker', 42], {
            id: 1,
            mode: 'veto',
            status: 'active',
        });
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        function wrapper({ children }: { children: ReactNode }) {
            return createElement(
                QueryClientProvider,
                { client: queryClient },
                children,
            );
        }

        const mod = await import('./use-lineup-realtime');
        const useLineupRealtime = mod.useLineupRealtime;

        renderHook(() => useLineupRealtime(42), { wrapper });

        await act(async () => {
            fireSocketEvent('lineup:tiebreaker:open', {
                lineupId: 42,
                tiebreakerId: 1,
                mode: 'veto',
            });
        });

        const tbCalls = invalidateSpy.mock.calls.filter(
            ([opts]) =>
                JSON.stringify(opts?.queryKey) ===
                JSON.stringify(['tiebreaker', 42]),
        );
        expect(tbCalls.length).toBeGreaterThanOrEqual(1);
    });
});
