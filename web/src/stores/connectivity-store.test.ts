import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useConnectivityStore } from './connectivity-store';

// Mock the config module so fetch calls use a predictable URL
vi.mock('../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

function resetStore() {
    useConnectivityStore.setState({
        status: 'checking',
        hasBeenOnline: false,
        lastOnlineAt: null,
        consecutiveFailures: 0,
    });
}

describe('useConnectivityStore', () => {
    beforeEach(() => {
        resetStore();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('check() — successful response', () => {
        it('sets status to "online" on successful fetch', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

            await useConnectivityStore.getState().check();

            expect(useConnectivityStore.getState().status).toBe('online');
        });

        it('sets hasBeenOnline to true on first success', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

            expect(useConnectivityStore.getState().hasBeenOnline).toBe(false);
            await useConnectivityStore.getState().check();
            expect(useConnectivityStore.getState().hasBeenOnline).toBe(true);
        });

        it('resets consecutiveFailures to 0 on success', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

            // Simulate some prior failures
            useConnectivityStore.setState({ consecutiveFailures: 3 });

            await useConnectivityStore.getState().check();

            expect(useConnectivityStore.getState().consecutiveFailures).toBe(0);
        });

        it('updates lastOnlineAt on success', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

            const before = Date.now();
            await useConnectivityStore.getState().check();
            const after = Date.now();

            const lastOnlineAt = useConnectivityStore.getState().lastOnlineAt;
            expect(lastOnlineAt).not.toBeNull();
            expect(lastOnlineAt!.getTime()).toBeGreaterThanOrEqual(before);
            expect(lastOnlineAt!.getTime()).toBeLessThanOrEqual(after);
        });
    });

    describe('check() — failed response (non-ok HTTP)', () => {
        it('increments consecutiveFailures on non-ok response', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

            await useConnectivityStore.getState().check();

            expect(useConnectivityStore.getState().consecutiveFailures).toBe(1);
        });

        it('does NOT set status to "offline" after only 1 failure', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

            // Start from checking
            useConnectivityStore.setState({ status: 'checking', consecutiveFailures: 0 });

            await useConnectivityStore.getState().check();

            expect(useConnectivityStore.getState().status).toBe('checking');
        });

        it('sets status to "offline" after 2 consecutive failures', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

            await useConnectivityStore.getState().check(); // failure 1
            await useConnectivityStore.getState().check(); // failure 2

            expect(useConnectivityStore.getState().status).toBe('offline');
        });

        it('accumulates failures across multiple non-ok responses', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

            await useConnectivityStore.getState().check();
            await useConnectivityStore.getState().check();
            await useConnectivityStore.getState().check();

            expect(useConnectivityStore.getState().consecutiveFailures).toBe(3);
        });
    });

    describe('check() — fetch throws (network error)', () => {
        it('increments consecutiveFailures on thrown error', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

            await useConnectivityStore.getState().check();

            expect(useConnectivityStore.getState().consecutiveFailures).toBe(1);
        });

        it('sets status to "offline" after 2 consecutive thrown errors', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

            await useConnectivityStore.getState().check(); // failure 1
            await useConnectivityStore.getState().check(); // failure 2

            expect(useConnectivityStore.getState().status).toBe('offline');
        });

        it('does NOT set status to "offline" after only 1 thrown error', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

            useConnectivityStore.setState({ status: 'checking', consecutiveFailures: 0 });

            await useConnectivityStore.getState().check();

            expect(useConnectivityStore.getState().status).toBe('checking');
        });
    });

    describe('check() — recovery from offline', () => {
        it('resets consecutiveFailures on recovery after being offline', async () => {
            // Prime with failures
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
            await useConnectivityStore.getState().check();
            await useConnectivityStore.getState().check();
            expect(useConnectivityStore.getState().status).toBe('offline');

            // Now recover
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
            await useConnectivityStore.getState().check();

            expect(useConnectivityStore.getState().consecutiveFailures).toBe(0);
            expect(useConnectivityStore.getState().status).toBe('online');
        });
    });

    describe('startPolling()', () => {
        it('calls check() immediately on start', async () => {
            const mockFetch = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', mockFetch);

            const stop = useConnectivityStore.getState().startPolling();

            // Flush only the microtasks/promises from the initial check (not the recursive poll timers)
            await Promise.resolve();
            await Promise.resolve();

            stop();

            expect(mockFetch).toHaveBeenCalled();
        });

        it('uses 30s interval when status is online', async () => {
            const mockFetch = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', mockFetch);

            const stop = useConnectivityStore.getState().startPolling();

            // Let the initial check promise resolve
            await Promise.resolve();
            await Promise.resolve();

            const callCountAfterInit = mockFetch.mock.calls.length;

            // Advance less than 30s — no new poll timer fires
            await vi.advanceTimersByTimeAsync(29_000);
            expect(mockFetch.mock.calls.length).toBe(callCountAfterInit);

            // Cross the 30s threshold — the next poll timer fires
            await vi.advanceTimersByTimeAsync(1_001);
            // Flush the promise from that poll
            await Promise.resolve();
            await Promise.resolve();

            expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountAfterInit);

            stop();
        });

        it('uses 3s interval when status is offline', async () => {
            // Start offline (2 failures already accumulated)
            useConnectivityStore.setState({
                status: 'offline',
                consecutiveFailures: 2,
                hasBeenOnline: false,
            });
            const mockFetch = vi.fn().mockResolvedValue({ ok: false });
            vi.stubGlobal('fetch', mockFetch);

            const stop = useConnectivityStore.getState().startPolling();

            // Let the initial check promise resolve
            await Promise.resolve();
            await Promise.resolve();

            const callCountAfterInit = mockFetch.mock.calls.length;

            // Advance past 3s — the next poll timer fires
            await vi.advanceTimersByTimeAsync(3_001);
            await Promise.resolve();
            await Promise.resolve();

            expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountAfterInit);

            stop();
        });

        it('returns a cleanup function that stops polling', async () => {
            const mockFetch = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', mockFetch);

            const stop = useConnectivityStore.getState().startPolling();

            // Let initial check resolve
            await Promise.resolve();
            await Promise.resolve();

            const callCountAtStop = mockFetch.mock.calls.length;
            stop();

            // After cleanup, advancing well past the poll interval should not trigger more fetches
            await vi.advanceTimersByTimeAsync(60_000);
            expect(mockFetch.mock.calls.length).toBe(callCountAtStop);
        });
    });
});
