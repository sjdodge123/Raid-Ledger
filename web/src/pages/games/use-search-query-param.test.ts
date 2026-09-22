/**
 * ROK-1615 — `q` hydrates the games page search box.
 *
 * Contract pinned here:
 *   - AC1: `searchQuery` initialises from `q`. A ONE-character `q` hydrates
 *     the box without claiming to search — `games-page.tsx` gates searching on
 *     `length >= 2`, so the hook must hand back the raw term and let the page
 *     decide, never silently blank a term it considers too short;
 *   - AC2: `lfg=1` and `q` are mutually exclusive VIEWS. Reading resolves it
 *     with `lfg` winning (`q` inert); writing a non-empty `q` deletes `lfg`,
 *     mirroring `applyLfgParam`'s existing delete of `q`. Both orders pinned;
 *   - AC3: every write goes out with `{ replace: true }` — asserted on the
 *     OPTIONS ARG, because the resulting query string is identical either way
 *     and only the call site proves it. Clearing DELETES `q`, never `q=`;
 *   - AC4: an over-long `q` (past `GameSearchQuerySchema`'s 100-char cap, the
 *     only value that could 400) is INACTIVE, never empty;
 *   - AC5: every write copies the previous params, so `genres` / `players` /
 *     `owners` round-trip alongside `q`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { resetLatestSearchParams } from './use-search-param-write';
import { useSearchQueryParam, MAX_SEARCH_QUERY_LENGTH } from './use-search-query-param';

/** Records the OPTIONS arg of every `setSearchParams` call (AC3). */
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

function makeWrapper(initialEntries: string[]) {
    return ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries }, children);
}

/** Exposes the live query string alongside the hook under test. */
function useHarness() {
    const [params] = useSearchParams();
    return { ...useSearchQueryParam(), search: params.toString() };
}

function renderSearchParam(url: string) {
    return renderHook(() => useHarness(), { wrapper: makeWrapper([url]) });
}

/** One character past the contract cap — the shortest malformed term. */
const OVER_LONG_QUERY = 'a'.repeat(MAX_SEARCH_QUERY_LENGTH + 1);

beforeEach(() => {
    setSearchParamsSpy.mockClear();
    // The write cache is module-scoped and survives between tests; a stale
    // entry would make a later render resolve against the wrong query string.
    resetLatestSearchParams();
});

describe('useSearchQueryParam — hydrating from the URL (AC1)', () => {
    it('initialises the box from ?q=', () => {
        const { result } = renderSearchParam('/games?q=deep+rock');

        expect(result.current.searchQuery).toBe('deep rock');
    });

    it('hydrates a one-character term verbatim, for the page to gate on', () => {
        const { result } = renderSearchParam('/games?q=d');

        expect(result.current.searchQuery).toBe('d');
    });

    it('is empty while q is absent, leaving the page unchanged', () => {
        const { result } = renderSearchParam('/games?genres=rpg');

        expect(result.current.searchQuery).toBe('');
    });

    it('treats an explicitly empty q as no search at all', () => {
        const { result } = renderSearchParam('/games?q=');

        expect(result.current.searchQuery).toBe('');
    });
});

describe('useSearchQueryParam — malformed input is inactive, never empty (AC4)', () => {
    it('ignores a term past the contract cap', () => {
        const { result } = renderSearchParam(`/games?q=${OVER_LONG_QUERY}`);

        expect(result.current.searchQuery).toBe('');
    });

    it('still hydrates a term exactly at the cap', () => {
        const atCap = 'a'.repeat(MAX_SEARCH_QUERY_LENGTH);

        const { result } = renderSearchParam(`/games?q=${atCap}`);

        expect(result.current.searchQuery).toBe(atCap);
    });
});

describe('useSearchQueryParam — lfg/search exclusivity (AC2)', () => {
    it('lets lfg=1 win when the URL carries the filter first', () => {
        const { result } = renderSearchParam('/games?lfg=1&q=deep');

        expect(result.current.searchQuery).toBe('');
    });

    it('lets lfg=1 win when the URL carries the search first', () => {
        const { result } = renderSearchParam('/games?q=deep&lfg=1');

        expect(result.current.searchQuery).toBe('');
    });

    it('only lfg=1 outranks a search — a stray lfg=0 does not', () => {
        const { result } = renderSearchParam('/games?lfg=0&q=deep');

        expect(result.current.searchQuery).toBe('deep');
    });

    it('drops lfg when a search is typed, so the views swap instead of stacking', () => {
        const { result } = renderSearchParam('/games?lfg=1');

        act(() => result.current.setSearchQuery('deep'));

        const params = new URLSearchParams(result.current.search);
        expect(params.get('q')).toBe('deep');
        expect(params.get('lfg')).toBeNull();
        expect(result.current.searchQuery).toBe('deep');
    });

    it('leaves lfg alone when the box is cleared — clearing turns nothing on', () => {
        const { result } = renderSearchParam('/games?lfg=0&q=deep');

        act(() => result.current.setSearchQuery(''));

        const params = new URLSearchParams(result.current.search);
        expect(params.get('q')).toBeNull();
        expect(params.get('lfg')).toBe('0');
    });
});

describe('useSearchQueryParam — writing keeps the URL in step (AC3)', () => {
    it('writes the typed term to q', () => {
        const { result } = renderSearchParam('/games');

        act(() => result.current.setSearchQuery('deep rock'));

        expect(new URLSearchParams(result.current.search).get('q')).toBe('deep rock');
        expect(result.current.searchQuery).toBe('deep rock');
    });

    it('writes with { replace: true } so Back does not unwind every keystroke', () => {
        const { result } = renderSearchParam('/games');

        act(() => result.current.setSearchQuery('deep'));

        expect(setSearchParamsSpy).toHaveBeenCalled();
        expect(setSearchParamsSpy.mock.calls[0][1]).toEqual({ replace: true });
    });

    it('deletes q when the box is cleared rather than leaving q=', () => {
        const { result } = renderSearchParam('/games?q=deep');

        act(() => result.current.setSearchQuery(''));

        expect(result.current.search).not.toContain('q=');
        expect(new URLSearchParams(result.current.search).get('q')).toBeNull();
    });

    it('clears with { replace: true } too', () => {
        const { result } = renderSearchParam('/games?q=deep');

        act(() => result.current.setSearchQuery(''));

        expect(setSearchParamsSpy.mock.calls[0][1]).toEqual({ replace: true });
    });
});

describe('useSearchQueryParam — surviving the sibling params (AC5)', () => {
    it('copies the previous params on a write', () => {
        const { result } = renderSearchParam('/games?genres=rpg&players=4&owners=2');

        act(() => result.current.setSearchQuery('deep'));

        const params = new URLSearchParams(result.current.search);
        expect(params.get('q')).toBe('deep');
        expect(params.get('genres')).toBe('rpg');
        expect(params.get('players')).toBe('4');
        expect(params.get('owners')).toBe('2');
    });

    it('copies them on a clear as well', () => {
        const { result } = renderSearchParam('/games?q=deep&genres=rpg&owners=2');

        act(() => result.current.setSearchQuery(''));

        const params = new URLSearchParams(result.current.search);
        expect(params.get('q')).toBeNull();
        expect(params.get('genres')).toBe('rpg');
        expect(params.get('owners')).toBe('2');
    });
});
