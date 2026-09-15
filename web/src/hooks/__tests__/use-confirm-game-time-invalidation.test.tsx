/**
 * ROK-1564 — "Looks right" must refresh BOTH the viewer's game time (so the
 * check closes) and the poll views (so the heatmap/row stop reading stale).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { createTestQueryClient } from '../../test/render-helpers';
import { GAME_TIME_QUERY_KEY, useConfirmGameTime } from '../use-game-time';

const confirmMock = vi.fn();

vi.mock('../../lib/api-client', () => ({
    getMyGameTime: vi.fn(),
    saveMyGameTime: vi.fn(),
    saveMyGameTimeOverrides: vi.fn(),
    confirmMyGameTime: (...args: unknown[]) => confirmMock(...args),
    createGameTimeAbsence: vi.fn(),
    deleteGameTimeAbsence: vi.fn(),
    getGameTimeAbsences: vi.fn(),
}));

function keysInvalidated(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
    return spy.mock.calls
        .map((call) => (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey)
        .filter((k): k is unknown[] => Array.isArray(k));
}

describe('useConfirmGameTime invalidation (ROK-1564)', () => {
    beforeEach(() => {
        confirmMock.mockReset().mockResolvedValue({ confirmedAt: '2026-09-15T00:00:00.000Z' });
    });

    it('invalidates the game-time query AND the scheduling views after a confirm', async () => {
        const queryClient = createTestQueryClient();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(QueryClientProvider, { client: queryClient }, children);
        const { result } = renderHook(() => useConfirmGameTime(), { wrapper });

        await act(async () => {
            result.current.mutate(undefined);
        });

        await waitFor(() => {
            const keys = keysInvalidated(invalidateSpy);
            expect(keys.some((k) => k[0] === GAME_TIME_QUERY_KEY[0])).toBe(true);
            expect(keys.some((k) => k[0] === 'scheduling')).toBe(true);
        });
        expect(confirmMock).toHaveBeenCalledTimes(1);
    });
});
