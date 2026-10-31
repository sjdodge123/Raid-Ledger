/**
 * ROK-1703 D-8 — `useWaitForBotJoin` polls the bot status every 3 s while
 * waiting, stops on join and on unmount, and checks permissions exactly once.
 * Fake timers drive the interval; adminFetch is mocked per path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BOT_JOIN_POLL_MS, useWaitForBotJoin } from './use-wait-for-bot-join';

const fetchMock = vi.fn();
vi.mock('../../../../hooks/admin/admin-fetch', () => ({ adminFetch: (path: string) => fetchMock(path) }));
vi.mock('../../../../hooks/use-auth', () => ({ getAuthToken: () => 'token' }));

const STATUS = '/admin/settings/discord-bot';
const PERMS = '/admin/settings/discord-bot/permissions';
const callsTo = (path: string): number => fetchMock.mock.calls.filter(([p]) => p === path).length;

/**
 * Advance the fake clock, then let the read that the last tick fired settle.
 * A poll fired at exactly `ms` resolves after the advance returns, and
 * TanStack hands the result to observers on a scheduled timeout — a 0 ms
 * advance does not run it, a 1 ms one (far below the 3 s interval) does.
 */
async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
        await vi.advanceTimersByTimeAsync(1);
    });
}

function wrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The bot joins on the `joinOn`-th status read (never, when 0). */
function botJoinsOnRead(joinOn: number): void {
    let reads = 0;
    fetchMock.mockImplementation(async (path: string) => {
        if (path === PERMS) return { allGranted: true, permissions: [{ name: 'View Channels', granted: true }] };
        reads += 1;
        return joinOn > 0 && reads >= joinOn ? { configured: true, connected: true, guildName: 'Ironforge Raiders' } : { configured: true, connected: false };
    });
}

describe('useWaitForBotJoin', () => {
    beforeEach(() => { vi.useFakeTimers(); fetchMock.mockReset(); });
    afterEach(() => { vi.useRealTimers(); });

    it('does not poll before the invite is opened', async () => {
        botJoinsOnRead(0);
        renderHook(() => useWaitForBotJoin(false), { wrapper: wrapper() });
        await advance(BOT_JOIN_POLL_MS * 3);
        expect(callsTo(STATUS)).toBe(1);
    });

    it('polls every 3 s while waiting, stops once joined and checks permissions once', async () => {
        botJoinsOnRead(3);
        const { result } = renderHook(() => useWaitForBotJoin(true), { wrapper: wrapper() });
        await advance(0);
        expect(callsTo(STATUS)).toBe(1);
        await advance(BOT_JOIN_POLL_MS * 2);
        expect(callsTo(STATUS)).toBe(3);
        expect(result.current.joined).toBe(true);
        await advance(BOT_JOIN_POLL_MS * 5);
        expect(callsTo(STATUS)).toBe(3);
        expect(callsTo(PERMS)).toBe(1);
        expect(result.current.permissions?.allGranted).toBe(true);
    });

    it('stops polling on unmount', async () => {
        botJoinsOnRead(0);
        const { unmount } = renderHook(() => useWaitForBotJoin(true), { wrapper: wrapper() });
        await advance(BOT_JOIN_POLL_MS);
        const before = callsTo(STATUS);
        expect(before).toBe(2);
        unmount();
        await advance(BOT_JOIN_POLL_MS * 5);
        expect(callsTo(STATUS)).toBe(before);
        expect(callsTo(PERMS)).toBe(0);
    });
});
