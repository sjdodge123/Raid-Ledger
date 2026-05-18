import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { GameInterestResponseDto } from '@raid-ledger/contract';
import { useWantToPlay } from './use-want-to-play';

const TOKEN_KEY = 'raid_ledger_token';
const GAME_ID = 19837;
const PER_GAME_KEY = ['games', 'interest', GAME_ID];
const BATCH_KEY_PREFIX = ['games', 'interest', 'batch'];
const HEARTED_KEY = ['userHeartedGames'];

function createTestHarness() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false },
        },
    });

    // Seed the three caches so invalidation calls have something to target.
    const seededInterest: GameInterestResponseDto = { wantToPlay: false, count: 0 };
    queryClient.setQueryData(PER_GAME_KEY, seededInterest);
    queryClient.setQueryData(
        ['games', 'interest', 'batch', [GAME_ID]],
        { data: { [String(GAME_ID)]: { wantToPlay: false, count: 0 } } },
    );
    queryClient.setQueryData(HEARTED_KEY, []);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    function wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    return { queryClient, invalidateSpy, wrapper, seededInterest };
}

function findCallWithExactKey(
    invalidateSpy: ReturnType<typeof vi.spyOn>,
    expectedKey: unknown[],
) {
    return invalidateSpy.mock.calls.find(
        ([opts]) =>
            JSON.stringify((opts as { queryKey?: unknown })?.queryKey) ===
            JSON.stringify(expectedKey),
    );
}

describe('Regression: ROK-1311 — detail-page wishlist toggle invalidates batch key', () => {
    beforeEach(() => {
        localStorage.setItem(TOKEN_KEY, 'test-jwt-token');
    });

    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('invalidates per-game, userHeartedGames, AND batch prefix on successful toggle ON', async () => {
        const { invalidateSpy, wrapper } = createTestHarness();

        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ wantToPlay: true, count: 1 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        const { result } = renderHook(() => useWantToPlay(GAME_ID), { wrapper });

        await act(async () => {
            result.current.toggle(true);
        });

        await waitFor(() => {
            expect(findCallWithExactKey(invalidateSpy, BATCH_KEY_PREFIX)).toBeDefined();
        });

        // All three invalidation calls must be present (per-game + userHearted + batch prefix).
        expect(findCallWithExactKey(invalidateSpy, PER_GAME_KEY)).toBeDefined();
        expect(findCallWithExactKey(invalidateSpy, HEARTED_KEY)).toBeDefined();
        expect(findCallWithExactKey(invalidateSpy, BATCH_KEY_PREFIX)).toBeDefined();
    });

    it('still invalidates batch prefix when mutation rejects (rollback path)', async () => {
        const { queryClient, invalidateSpy, wrapper, seededInterest } = createTestHarness();

        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('boom', { status: 500 }),
        );

        const { result } = renderHook(() => useWantToPlay(GAME_ID), { wrapper });

        await act(async () => {
            result.current.toggle(true);
        });

        // onSettled fires regardless of mutation outcome, so all three invalidations happen.
        await waitFor(() => {
            expect(findCallWithExactKey(invalidateSpy, BATCH_KEY_PREFIX)).toBeDefined();
        });
        expect(findCallWithExactKey(invalidateSpy, PER_GAME_KEY)).toBeDefined();
        expect(findCallWithExactKey(invalidateSpy, HEARTED_KEY)).toBeDefined();

        // Per-game cache rolled back to the seeded value.
        expect(queryClient.getQueryData(PER_GAME_KEY)).toEqual(seededInterest);
    });
});
