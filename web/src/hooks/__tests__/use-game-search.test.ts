/**
 * Regression: ROK-1233 — typeahead debounce + cancel.
 *
 * Validates that useGameSearch:
 *   1. debounces rapid keystrokes (no per-keystroke fetch),
 *   2. aborts in-flight requests for prior search terms when the user keeps
 *      typing, so older slow requests don't race with newer ones.
 *
 * The historical bug: TanStack Query only fires AbortSignal when the SAME
 * queryKey is re-fetched. Because each keystroke produced a different
 * queryKey, superseded requests were never cancelled and ran to completion
 * against IGDB (3-7s each), occasionally arriving AFTER newer ones.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const mockSearchGames = vi.fn();

vi.mock('../../lib/api-client', () => ({
    searchGames: (...args: unknown[]) => mockSearchGames(...args),
}));

vi.mock('../use-auth', () => ({
    getAuthToken: vi.fn().mockReturnValue(null),
    // ROK-1314: the hook now scopes its cache key by viewer.
    useViewerCacheScope: () => 'anon',
}));

import { useGameSearch } from '../use-game-search';

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    };
}

describe('useGameSearch — ROK-1233 debounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockSearchGames.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not fire a request per keystroke (400ms debounce)', async () => {
        mockSearchGames.mockResolvedValue({ data: [], meta: { total: 0, cached: false, source: 'igdb' } });

        const { rerender } = renderHook(
            ({ q }: { q: string }) => useGameSearch(q),
            { wrapper: createWrapper(), initialProps: { q: '' } },
        );

        // Simulate typing "grand theft" character-by-character at human speed.
        const phrase = 'grand theft';
        for (let i = 1; i <= phrase.length; i++) {
            rerender({ q: phrase.slice(0, i) });
            await act(async () => { await vi.advanceTimersByTimeAsync(50); }); // 50ms between keystrokes
        }

        // Mid-typing: nothing fired yet (debounce still pending).
        expect(mockSearchGames).not.toHaveBeenCalled();

        // After the debounce settles only ONE request fires (the final value).
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        await vi.waitFor(() => expect(mockSearchGames).toHaveBeenCalledTimes(1));
        expect(mockSearchGames).toHaveBeenCalledWith('grand theft', expect.any(AbortSignal));
    });

    it('does not fire when query is shorter than 2 characters', async () => {
        mockSearchGames.mockResolvedValue({ data: [], meta: { total: 0, cached: false, source: 'igdb' } });

        const { rerender } = renderHook(
            ({ q }: { q: string }) => useGameSearch(q),
            { wrapper: createWrapper(), initialProps: { q: '' } },
        );

        rerender({ q: 'a' });
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });

        expect(mockSearchGames).not.toHaveBeenCalled();
    });
});

describe('useGameSearch — ROK-1233 cancel superseded requests', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockSearchGames.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('aborts in-flight request for prior term when debounced query changes', async () => {
        // Capture the AbortSignal each call receives so we can assert which got aborted.
        const signals: AbortSignal[] = [];
        mockSearchGames.mockImplementation((_q: string, signal: AbortSignal) => {
            signals.push(signal);
            // Never resolves — simulates a slow IGDB call so the request remains in-flight.
            return new Promise(() => {});
        });

        const { rerender } = renderHook(
            ({ q }: { q: string }) => useGameSearch(q),
            { wrapper: createWrapper(), initialProps: { q: '' } },
        );

        // First search term: "return" — debounce fires, request kicks off.
        rerender({ q: 'return' });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        await vi.waitFor(() => expect(mockSearchGames).toHaveBeenCalledTimes(1));
        expect(signals[0].aborted).toBe(false);

        // User keeps typing — "return to moria" — debounce fires, second
        // request kicks off and the FIRST one must be aborted.
        rerender({ q: 'return to moria' });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        await vi.waitFor(() => expect(mockSearchGames).toHaveBeenCalledTimes(2));

        await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
        expect(signals[1].aborted).toBe(false);
        expect(mockSearchGames).toHaveBeenNthCalledWith(1, 'return', expect.any(AbortSignal));
        expect(mockSearchGames).toHaveBeenNthCalledWith(2, 'return to moria', expect.any(AbortSignal));
    });

    it('keeps at most one in-flight request even across multiple supersessions', async () => {
        const signals: AbortSignal[] = [];
        mockSearchGames.mockImplementation((_q: string, signal: AbortSignal) => {
            signals.push(signal);
            return new Promise(() => {});
        });

        const { rerender } = renderHook(
            ({ q }: { q: string }) => useGameSearch(q),
            { wrapper: createWrapper(), initialProps: { q: '' } },
        );

        // Three back-to-back debounced terms.
        for (const term of ['raft', 'grand theft', 'grand theft auto']) {
            rerender({ q: term });
            await act(async () => { await vi.advanceTimersByTimeAsync(400); });
            await vi.waitFor(() =>
                expect(mockSearchGames).toHaveBeenCalledWith(term, expect.any(AbortSignal)),
            );
        }

        // Final state: only the last signal is unaborted, all prior ones cancelled.
        await vi.waitFor(() => {
            const inFlight = signals.filter((s) => !s.aborted);
            expect(inFlight).toHaveLength(1);
        });
        expect(signals[signals.length - 1].aborted).toBe(false);
    });
});

describe('useGameSearch — ROK-1682 cancel is scoped to this instance', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockSearchGames.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('a newly mounted instance does not cancel another instance\'s in-flight search', async () => {
        const signals: AbortSignal[] = [];
        let resolveSearch: (value: unknown) => void = () => {};
        mockSearchGames.mockImplementation((_q: string, signal: AbortSignal) => {
            signals.push(signal);
            return new Promise((resolve) => { resolveSearch = resolve; });
        });
        const response = {
            data: [{ id: 1, name: 'Monster Hunter Wilds' }],
            meta: { total: 1, cached: false, source: 'igdb' },
        };
        const wrapper = createWrapper(); // one QueryClient shared by both hooks

        // /games page search: debounce settles, the slow request is in flight.
        const page = renderHook(() => useGameSearch('monster hunter', true), { wrapper });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        await vi.waitFor(() => expect(mockSearchGames).toHaveBeenCalledTimes(1));

        // LineupBanner lands and mounts a closed NominateModal on the same client.
        renderHook(() => useGameSearch('', false), { wrapper });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        await act(async () => {
            resolveSearch(response);
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(signals[0].aborted).toBe(false);
        await vi.waitFor(() => expect(page.result.current.data).toEqual(response));
    });
});

describe('useGameSearch — ROK-1682 shared term is not cancelled by one observer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockSearchGames.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // A second instance (open NominateModal, or another GameSearchInput row)
    // joins the page's in-flight term, then moves off it: closing resets it
    // to '' (NominateModal handleClose), or the user types on. The page is
    // still observing that query, so it must not be cancelled.
    it.each([
        ['closes (query reset to empty)', ''],
        ['types on to a longer term', 'monster hunter w'],
    ])('an instance sharing the page\'s term that %s does not cancel it', async (_label, nextTerm) => {
        const signals: AbortSignal[] = [];
        const resolvers: Array<(value: unknown) => void> = [];
        mockSearchGames.mockImplementation((_q: string, signal: AbortSignal) => {
            signals.push(signal);
            return new Promise((resolve) => { resolvers.push(resolve); });
        });
        const response = {
            data: [{ id: 1, name: 'Monster Hunter Wilds' }],
            meta: { total: 1, cached: false, source: 'igdb' },
        };
        const wrapper = createWrapper(); // one QueryClient shared by both hooks

        const page = renderHook(() => useGameSearch('monster hunter', true), { wrapper });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        await vi.waitFor(() => expect(mockSearchGames).toHaveBeenCalledTimes(1));

        // Second instance joins the same in-flight query (deduped: no new fetch)...
        const modal = renderHook(
            ({ q }: { q: string }) => useGameSearch(q, true),
            { wrapper, initialProps: { q: 'monster hunter' } },
        );
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        // ...then its debounced term moves off it.
        modal.rerender({ q: nextTerm });
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });

        await act(async () => {
            resolvers[0](response);
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(signals[0].aborted).toBe(false);
        await vi.waitFor(() => expect(page.result.current.data).toEqual(response));
    });
});
