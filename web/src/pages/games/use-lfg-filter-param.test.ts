/**
 * ROK-1453 AC3 — the `lfg=1` URL filter on the games page.
 *
 * TDD: `./use-lfg-filter-param` does not exist yet, so this file fails at
 * import. That is the intended pre-implementation failure.
 *
 * Contract pinned here (spec §Files → `use-lfg-filter-param.ts`, D6):
 *   • `useLfgFilterParam()` returns
 *     `{ isLfgOnly, matchesLfgFilter, clearLfgFilter }`;
 *   • `isLfgOnly` is true ONLY for `lfg=1` — the events banner writes exactly
 *     that, and a stray `lfg=0` must not silently empty the Library;
 *   • `matchesLfgFilter(gameId)` keeps only ids present in `GET /lfg` while
 *     the filter is on, and keeps EVERYTHING while it is off, so the games
 *     page can apply it unconditionally to `filteredRows` + `searchResults`;
 *   • `clearLfgFilter()` removes `lfg` and nothing else — the games page also
 *     carries search/genre state that a dismissal must not drop.
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
