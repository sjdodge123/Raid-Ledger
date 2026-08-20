/**
 * ROK-1400 (operator review 2026-08-20): the whole Common Ground filter set
 * — search text, min owners, players, and the co-op toggle + size — must
 * survive navigating away (e.g. into a game detail) and back, keyed per
 * lineup. These tests unmount and remount the panel's state hook to prove
 * it, rather than only testing the storage primitive underneath.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CommonGroundResponseDto } from '@raid-ledger/contract';
import { useCommonGroundState } from './use-common-ground-state';
import { useCommonGround } from '../../hooks/use-lineups';

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

/** Params the hook actually asked the API for on its latest render. */
function lastRequestedParams(): Record<string, unknown> {
    const calls = vi.mocked(useCommonGround).mock.calls;
    return calls[calls.length - 1][0] as Record<string, unknown>;
}

/** Make the mocked query resolve with a meta carrying `coopDataAvailable`. */
function mockCoopDataAvailable(available: boolean): void {
    vi.mocked(useCommonGround).mockReturnValue({
        data: {
            data: [],
            meta: { coopDataAvailable: available },
        } as unknown as CommonGroundResponseDto,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCommonGround>);
}

function renderState(lineupId = LINEUP) {
    return renderHook(() => useCommonGroundState(lineupId, true));
}

beforeEach(() => {
    window.sessionStorage.clear();
    // Reset call history + any per-test return override so each test sees a
    // fresh "no response yet" query.
    vi.mocked(useCommonGround).mockReset();
    vi.mocked(useCommonGround).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCommonGround>);
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

    it('does NOT send a persisted minOnlineCoop while the control is dormant', () => {
        // A filter stored before the catalogue lost/never had Co-Optimus
        // data. The user can neither see nor clear the toggle, so applying
        // it would silently empty the grid with no way out.
        window.sessionStorage.setItem(
            `common-ground:filters:${LINEUP}`,
            JSON.stringify({ minOwners: 2, minOnlineCoop: 5 }),
        );
        mockCoopDataAvailable(false);

        const { result } = renderState();

        expect(result.current.filters.minOnlineCoop).toBe(5); // still stored
        expect(result.current.coopDataAvailable).toBe(false);
        expect(lastRequestedParams()).not.toHaveProperty('minOnlineCoop');
        expect(lastRequestedParams()).toMatchObject({ minOwners: 2 });
    });

    it('sends the persisted minOnlineCoop once co-op data is available', () => {
        window.sessionStorage.setItem(
            `common-ground:filters:${LINEUP}`,
            JSON.stringify({ minOwners: 2, minOnlineCoop: 5 }),
        );
        mockCoopDataAvailable(true);

        const { result } = renderState();

        expect(result.current.coopDataAvailable).toBe(true);
        expect(lastRequestedParams()).toMatchObject({ minOnlineCoop: 5 });
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
