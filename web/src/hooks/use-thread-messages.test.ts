/**
 * ROK-1483 AC1 — the poll contract is pinned, not assumed.
 *
 * A regression on either of these two options is invisible in every rendered
 * test: the panel still shows messages, it just costs the API four times as
 * many reads (a shorter interval) or keeps polling every backgrounded tab
 * forever (`refetchIntervalInBackground: true`). So the options object itself
 * is the assertion target.
 *
 * `useQuery` is mocked rather than driven through a QueryClient because the
 * subject IS the options object — a real client would only let us observe the
 * options' effects, which is exactly the indirection that let the regression
 * hide in the first place.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ThreadSurfaceRef } from '@raid-ledger/contract';

const { useQuerySpy, getThreadMessagesSpy } = vi.hoisted(() => ({
    useQuerySpy: vi.fn(),
    getThreadMessagesSpy: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: useQuerySpy }));
vi.mock('../lib/api/discord-threads-api', () => ({
    getThreadMessages: getThreadMessagesSpy,
}));

import { THREAD_POLL_MS, useThreadMessages } from './use-thread-messages';

const SURFACE: ThreadSurfaceRef = { kind: 'lfg-group', id: '7' };

/**
 * The options object the hook handed to `useQuery`. The hook uses no other
 * React hook, so calling it directly is safe and keeps this file JSX-free.
 */
function useOptionsFor(
    threadId: string | undefined,
    before?: string,
): Record<string, unknown> {
    useThreadMessages(threadId, SURFACE, before);
    const call = useQuerySpy.mock.calls.at(-1);
    expect(call, 'useThreadMessages did not call useQuery at all').toBeDefined();
    return (call as unknown[])[0] as Record<string, unknown>;
}

describe('useThreadMessages', () => {
    beforeEach(() => {
        useQuerySpy.mockReset();
        useQuerySpy.mockReturnValue({ data: undefined, isLoading: true });
        getThreadMessagesSpy.mockReset();
        getThreadMessagesSpy.mockResolvedValue({ messages: [] });
    });

    it('polls every 20 seconds', () => {
        expect(
            useOptionsFor('T1').refetchInterval,
            'the thread poll interval is a load-bearing constant: halving it doubles API load for every open panel',
        ).toBe(20_000);
    });

    it('exports the interval as a named constant matching the option', () => {
        expect(THREAD_POLL_MS).toBe(20_000);
        expect(useOptionsFor('T1').refetchInterval).toBe(THREAD_POLL_MS);
    });

    it('does not poll a backgrounded tab', () => {
        expect(
            useOptionsFor('T1').refetchIntervalInBackground,
            'refetchIntervalInBackground must be explicitly false — a hidden tab must stop polling',
        ).toBe(false);
    });

    it('keys the cache by thread, surface and cursor', () => {
        expect(useOptionsFor('T1', 'M9').queryKey).toEqual([
            'discord-thread',
            'T1',
            'lfg-group',
            '7',
            'M9',
        ]);
    });

    it('is disabled until a thread id exists', () => {
        expect(useOptionsFor(undefined).enabled).toBe(false);
        expect(useOptionsFor('T1').enabled).toBe(true);
    });

    it('sends the surface claim and the backwards cursor to the API', async () => {
        const queryFn = useOptionsFor('T1', 'M9').queryFn as () => Promise<unknown>;
        await queryFn();
        expect(getThreadMessagesSpy).toHaveBeenCalledWith('T1', {
            surfaceKind: 'lfg-group',
            surfaceId: '7',
            before: 'M9',
        });
    });

    it('omits the cursor on the newest page', async () => {
        const queryFn = useOptionsFor('T1').queryFn as () => Promise<unknown>;
        await queryFn();
        expect(getThreadMessagesSpy).toHaveBeenCalledWith('T1', {
            surfaceKind: 'lfg-group',
            surfaceId: '7',
            before: undefined,
        });
    });
});
