/**
 * ROK-1569 — "Save my week" on the poll page must refresh the poll views too:
 * the server stamps a saved week as confirmed, so the group heatmap and the
 * viewer's freshness change with the same write (Codex finding).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { createTestQueryClient } from '../../test/render-helpers';
import { GAME_TIME_QUERY_KEY, useSaveGameTime } from '../use-game-time';

const saveMock = vi.fn();

vi.mock('../../lib/api-client', () => ({
    getMyGameTime: vi.fn(),
    saveMyGameTime: (...args: unknown[]) => saveMock(...args),
    saveMyGameTimeOverrides: vi.fn(),
    confirmMyGameTime: vi.fn(),
    createGameTimeAbsence: vi.fn(),
    deleteGameTimeAbsence: vi.fn(),
    getGameTimeAbsences: vi.fn(),
}));

function keysInvalidated(spy: ReturnType<typeof vi.spyOn>): unknown[][] {
    return spy.mock.calls
        .map((call) => (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey)
        .filter((k): k is unknown[] => Array.isArray(k));
}

describe('useSaveGameTime invalidation (ROK-1569)', () => {
    beforeEach(() => {
        saveMock.mockReset().mockResolvedValue({ slots: [] });
    });

    it('invalidates the game-time query AND the scheduling views after a save', async () => {
        const queryClient = createTestQueryClient();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(QueryClientProvider, { client: queryClient }, children);
        const { result } = renderHook(() => useSaveGameTime(), { wrapper });

        await act(async () => {
            result.current.mutate([{ dayOfWeek: 0, hour: 19 }]);
        });

        await waitFor(() => {
            const keys = keysInvalidated(invalidateSpy);
            expect(keys.some((k) => k[0] === GAME_TIME_QUERY_KEY[0])).toBe(true);
            expect(keys.some((k) => k[0] === 'scheduling')).toBe(true);
        });
        expect(saveMock).toHaveBeenCalledTimes(1);
    });
});
