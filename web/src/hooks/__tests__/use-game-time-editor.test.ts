/**
 * useGameTimeEditor is the single-week template editor (TDB:1933). The rolling
 * mode and its second, next-week `useGameTime` query were removed with the
 * rolling DayHeader they fed — no surface had mounted them since ROK-1426.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const useGameTimeMock = vi.fn();
vi.mock('../use-game-time', () => ({
    useGameTime: (options?: unknown) => useGameTimeMock(options),
    useSaveGameTime: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSaveGameTimeOverrides: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useGameTimeEditor } from '../use-game-time-editor';

describe('useGameTimeEditor (single-week template editor)', () => {
    beforeEach(() => {
        useGameTimeMock.mockReset();
        useGameTimeMock.mockReturnValue({
            data: {
                weekStart: '2026-02-08',
                events: [],
                slots: [
                    { dayOfWeek: 1, hour: 19, status: 'available', fromTemplate: true },
                    { dayOfWeek: 1, hour: 20, status: 'committed', fromTemplate: true },
                    { dayOfWeek: 2, hour: 21, status: 'committed', fromTemplate: false },
                ],
            },
            isLoading: false,
        });
    });

    it('issues exactly one useGameTime query per render, for the current week (no next-week query)', () => {
        const { rerender } = renderHook(() => useGameTimeEditor({ enabled: true }));
        const before = useGameTimeMock.mock.calls.length;
        rerender();

        expect(useGameTimeMock.mock.calls.length - before, 'one useGameTime call per render').toBe(1);
        const weeks = useGameTimeMock.mock.calls.map(([opts]) => (opts as { week?: string }).week);
        expect(weeks.filter((w) => w !== undefined), 'no call may ask for another week').toEqual([]);
    });

    it('shows template slots only, with commitments flattened to available', () => {
        const { result } = renderHook(() => useGameTimeEditor({ enabled: true }));

        expect(result.current.slots).toEqual([
            { dayOfWeek: 1, hour: 19, status: 'available' },
            { dayOfWeek: 1, hour: 20, status: 'available' },
        ]);
    });

    it('no longer returns next-week slots or events', () => {
        const { result } = renderHook(() => useGameTimeEditor({ enabled: true }));

        expect(result.current).not.toHaveProperty('nextWeekSlots');
        expect(result.current).not.toHaveProperty('nextWeekEvents');
    });
});
