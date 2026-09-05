/**
 * ROK-1453 AC3 — the `lfg=1` URL filter on the games page.
 *
 * TDD: `./use-lfg-filter-param` does not exist yet, so this file fails at
 * import. That is the intended pre-implementation failure.
 *
 * Contract pinned here (spec §Files → `use-lfg-filter-param.ts`, D6, as
 * amended by ROK-1478 AC1 + ambiguity A5):
 *   • `useLfgFilterParam()` returns `{ isLfgOnly, matchesLfgFilter,
 *     clearLfgFilter, setLfgFilter, toggleLfgFilter }` — ROK-1478 added the
 *     two writers, which is what makes the chip a two-way control;
 *   • `isLfgOnly` is true ONLY for `lfg=1` — the events banner writes exactly
 *     that, and a stray `lfg=0` must not silently empty the Library;
 *   • `matchesLfgFilter(gameId)` keeps only ids present in `GET /lfg` while
 *     the filter is on, and keeps EVERYTHING while it is off, so the games
 *     page can apply it unconditionally to `filteredRows` + `searchResults`;
 *   • `clearLfgFilter()` removes `lfg` and nothing else — the games page also
 *     carries search/genre state that a dismissal must not drop;
 *   • turning the filter ON drops `q` and ONLY `q` (A5): the page renders the
 *     looking grid or the search results, never both, so the URL must not
 *     encode two mutually exclusive views at once. Turning it OFF is not
 *     symmetric — it leaves `q` alone.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { server } from '../../test/mocks/server';
import { lfgGroupsHandler } from '../../test/mocks/lfg-handlers';
import { buildLfgGroupSummary } from '../../test/factories/lfg';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { createTestQueryClient } from '../../test/render-helpers';
import { useLfgFilterParam } from './use-lfg-filter-param';

/** Two games are looking; a third id is deliberately absent from the list. */
const LOOKING_IDS = [11, 22];
const NOT_LOOKING_ID = 33;

function seedGroups(ids: number[] = LOOKING_IDS) {
    server.use(
        lfgGroupsHandler(
            ids.map((id) =>
                buildLfgGroupSummary({
                    gameId: id,
                    gameName: `Game ${id}`,
                    gameSlug: `game-${id}`,
                }),
            ),
        ),
    );
}

function makeWrapper(initialEntries: string[]) {
    const queryClient = createTestQueryClient();
    return ({ children }: { children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(MemoryRouter, { initialEntries }, children),
        );
}

/** Exposes the live query string alongside the hook under test. */
function useHarness() {
    const [params] = useSearchParams();
    return { ...useLfgFilterParam(), search: params.toString() };
}

function renderFilter(url: string) {
    return renderHook(() => useHarness(), { wrapper: makeWrapper([url]) });
}

beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    seedGroups();
});

describe('useLfgFilterParam — reading the param', () => {
    it('activates on lfg=1', () => {
        const { result } = renderFilter('/games?lfg=1');

        expect(result.current.isLfgOnly).toBe(true);
    });

    it('is inactive with no param', () => {
        const { result } = renderFilter('/games');

        expect(result.current.isLfgOnly).toBe(false);
    });

    it('is inactive for any other value', () => {
        const { result } = renderFilter('/games?lfg=0');

        expect(result.current.isLfgOnly).toBe(false);
    });
});

describe('useLfgFilterParam — the predicate', () => {
    it('keeps only games that appear in GET /lfg while active', async () => {
        const { result } = renderFilter('/games?lfg=1');

        // Gate on the EXCLUSION, not on an inclusion: an id that is looking
        // passes both before and after the read resolves (nothing is filtered
        // until the read succeeds), so waiting on it would settle immediately
        // and assert the exclusion against a still-loading hook.
        await waitFor(() => {
            expect(result.current.matchesLfgFilter(NOT_LOOKING_ID)).toBe(false);
        });
        expect(result.current.matchesLfgFilter(LOOKING_IDS[0])).toBe(true);
        expect(result.current.matchesLfgFilter(LOOKING_IDS[1])).toBe(true);
    });

    it('keeps every game while inactive', async () => {
        const { result } = renderFilter('/games');

        await waitFor(() => {
            expect(result.current.matchesLfgFilter(NOT_LOOKING_ID)).toBe(true);
        });
        expect(result.current.matchesLfgFilter(LOOKING_IDS[0])).toBe(true);
    });

    it('keeps every game while GET /lfg is still in flight', () => {
        // Reviewer catch: an empty `lookingIds` before the response lands is
        // indistinguishable from "nobody is looking", so rejecting on it paints
        // an empty Library for the first frame — and forever when the query is
        // disabled (logged out). Nothing has been excluded until the read
        // actually succeeded.
        const { result } = renderFilter('/games?lfg=1');

        expect(result.current.isLfgOnly).toBe(true);
        expect(result.current.matchesLfgFilter(NOT_LOOKING_ID)).toBe(true);
    });

    it('excludes everything when nobody is looking at all', async () => {
        seedGroups([]);
        const { result } = renderFilter('/games?lfg=1');

        await waitFor(() => {
            expect(result.current.matchesLfgFilter(LOOKING_IDS[0])).toBe(false);
        });
    });
});

describe('useLfgFilterParam — clearing', () => {
    it('removes lfg and leaves the other params untouched', async () => {
        const { result } = renderFilter('/games?q=deep&lfg=1&genre=rpg');

        act(() => result.current.clearLfgFilter());

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(false);
        });
        const params = new URLSearchParams(result.current.search);
        expect(params.get('lfg')).toBeNull();
        expect(params.get('q')).toBe('deep');
        expect(params.get('genre')).toBe('rpg');
    });

    it('is a no-op when the filter is already off', async () => {
        const { result } = renderFilter('/games?q=deep');

        act(() => result.current.clearLfgFilter());

        await waitFor(() => {
            expect(result.current.search).toBe('q=deep');
        });
        expect(result.current.isLfgOnly).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// ROK-1478 AC1 — the hook gains a WRITER.
//
// Before this story the hook could only READ `lfg` and CLEAR it, so nothing in
// the app could turn the filter on except a hand-authored link. `setLfgFilter`
// and `toggleLfgFilter` are what make the chip a two-way control (D2); the
// clearing cases above stay untouched because `clearLfgFilter` keeps its exact
// semantics as a delegate of `setLfgFilter(false)`.
// ---------------------------------------------------------------------------

describe('useLfgFilterParam — writing the param (ROK-1478 AC1)', () => {
    it('setLfgFilter(true) activates the filter and writes lfg=1', async () => {
        const { result } = renderFilter('/games');

        act(() => result.current.setLfgFilter(true));

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(true);
        });
        expect(new URLSearchParams(result.current.search).get('lfg')).toBe('1');
    });

    it('setLfgFilter(true) preserves every param except the search query', async () => {
        const { result } = renderFilter('/games?genre=rpg&showHidden=only');

        act(() => result.current.setLfgFilter(true));

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(true);
        });
        const params = new URLSearchParams(result.current.search);
        expect(params.get('genre')).toBe('rpg');
        expect(params.get('showHidden')).toBe('only');
    });

    it('setLfgFilter(false) removes lfg and nothing else', async () => {
        const { result } = renderFilter('/games?q=deep&lfg=1');

        act(() => result.current.setLfgFilter(false));

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(false);
        });
        const params = new URLSearchParams(result.current.search);
        expect(params.get('lfg')).toBeNull();
        expect(params.get('q')).toBe('deep');
    });

    it('toggleLfgFilter turns an inactive filter on', async () => {
        const { result } = renderFilter('/games?genre=rpg');

        act(() => result.current.toggleLfgFilter());

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(true);
        });
        expect(new URLSearchParams(result.current.search).get('genre')).toBe(
            'rpg',
        );
    });

    it('toggleLfgFilter removes only lfg when it is already on', async () => {
        const { result } = renderFilter('/games?q=deep&lfg=1&genre=rpg');

        act(() => result.current.toggleLfgFilter());

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(false);
        });
        const params = new URLSearchParams(result.current.search);
        expect(params.get('lfg')).toBeNull();
        expect(params.get('q')).toBe('deep');
        expect(params.get('genre')).toBe('rpg');
    });
});

// ---------------------------------------------------------------------------
// ROK-1478 ambiguity A5 (Lead ruling) — search and the filter are mutually
// exclusive VIEWS, so they must not both be encoded in the URL.
//
// `games-page.tsx:151-157` is `isLfgOnly ? <LfgLookingGrid/> : isSearching ?
// <SearchResults/> : <DiscoverContent/>`. With the filter on, a search term is
// inert — the grid wins and nothing tells the user why. Turning the filter ON
// therefore drops `q`. Turning it OFF is deliberately NOT symmetric: dropping
// a `q` on the way out would delete state the user never asked to lose.
// ---------------------------------------------------------------------------

describe('useLfgFilterParam — search vs filter (A5)', () => {
    it('setLfgFilter(true) drops the search query', async () => {
        const { result } = renderFilter('/games?q=hell');

        act(() => result.current.setLfgFilter(true));

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(true);
        });
        expect(result.current.search).toBe('lfg=1');
    });

    it('toggling the filter on drops the search query but keeps the genre', async () => {
        const { result } = renderFilter('/games?q=hell&genre=rpg');

        act(() => result.current.toggleLfgFilter());

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(true);
        });
        const params = new URLSearchParams(result.current.search);
        expect(params.get('q')).toBeNull();
        expect(params.get('genre')).toBe('rpg');
    });

    it('turning the filter off leaves an existing search query alone', async () => {
        const { result } = renderFilter('/games?q=hell&lfg=1');

        act(() => result.current.setLfgFilter(false));

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(false);
        });
        expect(result.current.search).toBe('q=hell');
    });

    it('clearLfgFilter still leaves the search query alone', async () => {
        const { result } = renderFilter('/games?q=hell&lfg=1');

        act(() => result.current.clearLfgFilter());

        await waitFor(() => {
            expect(result.current.isLfgOnly).toBe(false);
        });
        expect(result.current.search).toBe('q=hell');
    });
});

// ---------------------------------------------------------------------------
// ROK-1478 review finding 4 — `toggleLfgFilter` resolves its target INSIDE the
// `setSearchParams` updater, from the params it is handed, rather than from a
// render-scoped `isLfgOnly`.
//
// NO TEST CAN DISTINGUISH THE TWO FORMS on react-router 7.18.2, and the
// reviewer's proposed double-press case is therefore NOT in this file. Measured
// (see the lane handover for the verbatim run): `useSearchParams` calls
// `nextInit(new URLSearchParams(searchParams))` where `searchParams` is
// memoised on `location.search`, so two synchronous presses inside one `act()`
// are handed the SAME params object and both resolve to the same target. The
// double press nets out to `genre=rpg&lfg=1` under BOTH implementations.
//
// What IS observable is that the flip is a function of the URL, which these
// cases pin in both directions, plus `setLfgFilter`'s two directional cases
// above. The change is kept for robustness (it is correct by construction if
// react-router ever hands the updater the pending params) — not because it
// fixes a reproducible bug.
// ---------------------------------------------------------------------------

describe('useLfgFilterParam — the toggle reads the URL, not a captured flag', () => {
    it('flips off after a write that turned it on', async () => {
        const { result } = renderFilter('/games?genre=rpg');

        act(() => result.current.setLfgFilter(true));
        await waitFor(() => expect(result.current.isLfgOnly).toBe(true));

        act(() => result.current.toggleLfgFilter());

        await waitFor(() => {
            expect(result.current.search).toBe('genre=rpg');
        });
        expect(result.current.isLfgOnly).toBe(false);
    });
});
