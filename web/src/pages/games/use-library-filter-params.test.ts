/**
 * ROK-1525 slice 2 — `players` / `owners` as URL state, the ROK-1478 pattern.
 *
 * TDD: `./use-library-filter-params` does not exist yet, so this file fails at
 * import. That is the intended pre-implementation failure.
 *
 * Contract pinned here (operator rulings 2026-09-12 → "the combined state is
 * URL-persisted the way ROK-1478's filter is"):
 *   • `?players=<key>` is active only for a key in `PLAYER_COUNT_PRESETS`, and
 *     `?owners=<n>` only for a positive integer. Anything else — `players=99`,
 *     `players=abc`, `owners=-1`, `owners=0` — reads INACTIVE and keeps every
 *     row, because a malformed URL must never silently empty the Library;
 *   • every write copies the PREVIOUS params, so `lfg`, `q`, `genre` and the
 *     sibling filter all survive each other's writes. Note `lfg=1` deliberately
 *     drops `q` (`use-lfg-filter-param.ts:61-70`) — these writers must NOT
 *     inherit that, they are view NARROWERS, not a mutually exclusive view;
 *   • both directions use `{ replace: true }` (ROK-1478 ambiguity A2) so a
 *     chip row does not stack history entries the Back button has to unwind
 *     one press at a time. Asserted on the OPTIONS ARG, not on the URL — the
 *     resulting query string is identical either way, so only the call site
 *     proves it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import type { LibraryFilterableGame } from './library-filter.helpers';
import { useLibraryFilterParams } from './use-library-filter-params';

/** Records the OPTIONS arg of every `setSearchParams` call (case 6). */
const { setSearchParamsSpy } = vi.hoisted(() => ({
    setSearchParamsSpy: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        useSearchParams: () => {
            const [params, setParams] = actual.useSearchParams();
            const spied = (...args: Parameters<typeof setParams>) => {
                setSearchParamsSpy(...args);
                return setParams(...args);
            };
            return [params, spied] as ReturnType<typeof actual.useSearchParams>;
        },
    };
});

/** A party game (1-4) and a raid game (5-8) — one straddles 4, one does not. */
const PARTY_GAME: LibraryFilterableGame = {
    playerCount: { min: 1, max: 4 },
    ownerCount: 4,
};
const RAID_GAME: LibraryFilterableGame = {
    playerCount: { min: 5, max: 8 },
    ownerCount: 1,
};
const UNKNOWN_GAME: LibraryFilterableGame = {};

function makeWrapper(initialEntries: string[]) {
    return ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries }, children);
}

/** Exposes the live query string alongside the hook under test. */
function useHarness() {
    const [params] = useSearchParams();
    return { ...useLibraryFilterParams(), search: params.toString() };
}

function renderFilters(url: string) {
    return renderHook(() => useHarness(), { wrapper: makeWrapper([url]) });
}

beforeEach(() => {
    setSearchParamsSpy.mockClear();
});

describe('useLibraryFilterParams — reading the params', () => {
    it('activates on players=4 and its predicate matches a 1-4 game', () => {
        const { result } = renderFilters('/games?players=4');

        expect(result.current.playersFilter).toBe('4');
        expect(result.current.isLibraryFiltered).toBe(true);
        expect(result.current.matchesLibraryFilters(PARTY_GAME)).toBe(true);
        expect(result.current.matchesLibraryFilters(RAID_GAME)).toBe(false);
    });

    it('activates on the open-ended players=5plus tail', () => {
        const { result } = renderFilters('/games?players=5plus');

        expect(result.current.playersFilter).toBe('5plus');
        expect(result.current.isLibraryFiltered).toBe(true);
        expect(result.current.matchesLibraryFilters(RAID_GAME)).toBe(true);
        expect(result.current.matchesLibraryFilters(PARTY_GAME)).toBe(false);
    });

    it('reads owners=2 as "owned by at least 2"', () => {
        const { result } = renderFilters('/games?owners=2');

        expect(result.current.minOwners).toBe(2);
        expect(result.current.matchesLibraryFilters(PARTY_GAME)).toBe(true);
        expect(result.current.matchesLibraryFilters(RAID_GAME)).toBe(false);
    });

    it.each([
        ['players=99', 'an out-of-range preset key'],
        ['players=abc', 'a non-numeric preset key'],
        ['players=', 'an empty preset key'],
        ['owners=-1', 'a negative owner count'],
        ['owners=0', 'a zero owner count'],
        ['owners=abc', 'a non-numeric owner count'],
        ['owners=2.5', 'a fractional owner count'],
    ])('treats %s (%s) as INACTIVE and keeps everything', (query) => {
        const { result } = renderFilters(`/games?${query}`);

        expect(result.current.playersFilter).toBeNull();
        expect(result.current.minOwners).toBeNull();
        expect(result.current.isLibraryFiltered).toBe(false);
        // The whole point: a malformed URL must not empty the grid. Even the
        // row with no data at all — which an ACTIVE predicate excludes — is
        // kept here, because no predicate is running.
        expect(result.current.matchesLibraryFilters(UNKNOWN_GAME)).toBe(true);
        expect(result.current.filterLibraryRows([PARTY_GAME, RAID_GAME])).toHaveLength(2);
    });
});

describe('useLibraryFilterParams — writing the params', () => {
    it('setting players preserves lfg, owners and q', async () => {
        const { result } = renderFilters('/games?q=deep&lfg=1&owners=3');

        act(() => result.current.setPlayersFilter('4'));

        await waitFor(() => {
            expect(result.current.playersFilter).toBe('4');
        });
        const params = new URLSearchParams(result.current.search);
        expect(params.get('q')).toBe('deep');
        expect(params.get('lfg')).toBe('1');
        expect(params.get('owners')).toBe('3');
    });

    it('clearing players drops ONLY players', async () => {
        const { result } = renderFilters('/games?q=deep&lfg=1&players=4&owners=3&genre=rpg');

        act(() => result.current.setPlayersFilter(null));

        await waitFor(() => {
            expect(result.current.playersFilter).toBeNull();
        });
        const params = new URLSearchParams(result.current.search);
        expect(params.get('players')).toBeNull();
        expect(params.get('q')).toBe('deep');
        expect(params.get('lfg')).toBe('1');
        expect(params.get('owners')).toBe('3');
        expect(params.get('genre')).toBe('rpg');
    });

    it('toggling the active players chip turns it off, a different one swaps it', async () => {
        const { result } = renderFilters('/games?players=4');

        act(() => result.current.togglePlayersFilter('4'));
        await waitFor(() => expect(result.current.playersFilter).toBeNull());

        act(() => result.current.togglePlayersFilter('2'));
        await waitFor(() => expect(result.current.playersFilter).toBe('2'));
    });

});

describe('useLibraryFilterParams — writing the params (owners + clear all)', () => {
    it('setMinOwners writes owners and clears it on null / 0', async () => {
        const { result } = renderFilters('/games?players=4');

        act(() => result.current.setMinOwners(3));
        await waitFor(() => expect(result.current.minOwners).toBe(3));
        expect(new URLSearchParams(result.current.search).get('players')).toBe('4');

        act(() => result.current.setMinOwners(0));
        await waitFor(() => expect(result.current.minOwners).toBeNull());
        expect(new URLSearchParams(result.current.search).get('owners')).toBeNull();
    });

    it('clearLibraryFilters drops both params and nothing else', async () => {
        const { result } = renderFilters('/games?q=deep&lfg=1&players=4&owners=3');

        act(() => result.current.clearLibraryFilters());

        await waitFor(() => {
            expect(result.current.isLibraryFiltered).toBe(false);
        });
        const params = new URLSearchParams(result.current.search);
        expect(params.get('players')).toBeNull();
        expect(params.get('owners')).toBeNull();
        expect(params.get('q')).toBe('deep');
        expect(params.get('lfg')).toBe('1');
    });

    it('writes in BOTH directions with { replace: true }', async () => {
        const { result } = renderFilters('/games');

        act(() => result.current.setPlayersFilter('4'));
        await waitFor(() => expect(result.current.playersFilter).toBe('4'));
        act(() => result.current.setMinOwners(2));
        await waitFor(() => expect(result.current.minOwners).toBe(2));
        act(() => result.current.setPlayersFilter(null));
        await waitFor(() => expect(result.current.playersFilter).toBeNull());
        act(() => result.current.setMinOwners(null));
        await waitFor(() => expect(result.current.minOwners).toBeNull());

        expect(setSearchParamsSpy).toHaveBeenCalledTimes(4);
        for (const call of setSearchParamsSpy.mock.calls) {
            expect(call[1]).toEqual({ replace: true });
        }
    });
});
