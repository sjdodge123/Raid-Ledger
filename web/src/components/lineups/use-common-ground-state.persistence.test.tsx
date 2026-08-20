/**
 * ROK-1400 (operator review 2026-08-20): the whole Common Ground filter set
 * — search text, min owners, players, and the co-op toggle + size — must
 * survive navigating away (e.g. into a game detail) and back, keyed per
 * lineup. These tests unmount and remount the panel's state hook to prove
 * it, rather than only testing the storage primitive underneath.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommonGroundState } from './use-common-ground-state';

vi.mock('../../hooks/use-lineups', () => ({
    useActiveLineups: vi.fn(() => ({ data: [] })),
    useCommonGround: vi.fn(() => ({
        data: undefined,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
    })),
    useNominateGame: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('../../hooks/use-ai-suggestions', () => ({
    useAiSuggestions: vi.fn(() => ({ data: undefined })),
}));
vi.mock('../../hooks/use-ai-suggestions-available', () => ({
    useAiSuggestionsAvailable: vi.fn(() => false),
}));
// Identity debounce so assertions don't wait on timers.
vi.mock('../../hooks/use-debounced-value', () => ({
    useDebouncedValue: <T,>(v: T): T => v,
}));

const LINEUP = 7;

function renderState(lineupId = LINEUP) {
    return renderHook(() => useCommonGroundState(lineupId, true));
}

beforeEach(() => {
    window.sessionStorage.clear();
});

describe('useCommonGroundState — filter persistence (ROK-1400)', () => {
    it('starts from defaults on a first visit', () => {
        const { result } = renderState();
        expect(result.current.filters).toEqual({ minOwners: 0 });
        expect(result.current.search).toBe('');
        expect(result.current.filtersRestored).toBe(false);
    });

    it('restores the whole filter set across unmount / remount', () => {
        const first = renderState();
        act(() =>
            first.result.current.setFilters({
                minOwners: 3,
                maxPlayers: 4,
                minOnlineCoop: 5,
            }),
        );
        act(() => first.result.current.setSearch('valheim'));
        first.unmount();

        // Navigating back into the panel.
        const second = renderState();
        expect(second.result.current.filters).toEqual({
            minOwners: 3,
            maxPlayers: 4,
            minOnlineCoop: 5,
        });
        expect(second.result.current.search).toBe('valheim');
        expect(second.result.current.filtersRestored).toBe(true);
    });

    it('restores a cleared co-op toggle as cleared (not re-seeded)', () => {
        const first = renderState();
        act(() =>
            first.result.current.setFilters({
                minOwners: 0,
                minOnlineCoop: undefined,
            }),
        );
        first.unmount();

        const second = renderState();
        expect(second.result.current.filters.minOnlineCoop).toBeUndefined();
    });

    it('keys state per lineup — a different lineup starts clean', () => {
        const first = renderState(LINEUP);
        act(() => first.result.current.setFilters({ minOwners: 9 }));
        act(() => first.result.current.setSearch('only-for-seven'));
        first.unmount();

        const other = renderState(LINEUP + 1);
        expect(other.result.current.filters).toEqual({ minOwners: 0 });
        expect(other.result.current.search).toBe('');
    });
});
