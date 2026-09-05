/**
 * The `lfg=1` URL filter on the games page (ROK-1453 AC3, spec decision D6).
 *
 * The events banner links to `/games?lfg=1`; this hook reads that param and
 * hands back a predicate the page applies unconditionally to both the search
 * results and the discover rows. While the filter is OFF — or while the group
 * read has not yet succeeded — the predicate keeps everything, so callers never
 * branch on `isLfgOnly` themselves and never render a spuriously empty grid.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLfgGroups } from '../../hooks/use-lfg-groups';

/** The one value that turns the filter on — `lfg=0` must not empty the page. */
const ACTIVE_VALUE = '1';
const PARAM = 'lfg';

export interface LfgFilterParam {
    /** True only for `?lfg=1`. */
    isLfgOnly: boolean;
    /** Keeps games with a live intent while active; keeps all while inactive. */
    matchesLfgFilter: (gameId: number) => boolean;
    /** Drop `lfg` and nothing else — search/genre params must survive. */
    clearLfgFilter: () => void;
    /** Write or drop `lfg=1`, leaving every other search param in place. */
    setLfgFilter: (on: boolean) => void;
    /** Flip the filter — the toggle chip's only action (ROK-1478 AC1). */
    toggleLfgFilter: () => void;
}

/** Add or drop `lfg` on a COPY of the current params — nothing else moves. */
function applyLfgParam(prev: URLSearchParams, on: boolean): URLSearchParams {
    const next = new URLSearchParams(prev);
    if (on) next.set(PARAM, ACTIVE_VALUE);
    else next.delete(PARAM);
    return next;
}

/**
 * The writer half, split out to keep `useLfgFilterParam` under the 30-line
 * function budget.
 *
 * `replace` in BOTH directions (spec ROK-1478 ambiguity A2): toggling a view
 * filter should not stack history entries the Back button then has to walk
 * back out of one press at a time.
 */
function useLfgFilterWriter(): (on: boolean) => void {
    const [, setSearchParams] = useSearchParams();
    return useCallback(
        (on: boolean) =>
            setSearchParams((prev) => applyLfgParam(prev, on), {
                replace: true,
            }),
        [setSearchParams],
    );
}

/** Read/write the `lfg` search param and derive the matching predicate. */
export function useLfgFilterParam(): LfgFilterParam {
    const [searchParams] = useSearchParams();
    const { data, isSuccess } = useLfgGroups();

    const isLfgOnly = searchParams.get(PARAM) === ACTIVE_VALUE;

    const lookingIds = useMemo(
        () => new Set((data ?? []).map((group) => group.gameId)),
        [data],
    );

    // `isSuccess` is load-bearing: before the read lands (and permanently while
    // it is disabled for a logged-out viewer) `lookingIds` is empty, which is
    // indistinguishable from "nobody is looking". Excluding on that empties the
    // Library for a frame — or forever. Nothing is filtered until we know.
    const matchesLfgFilter = useCallback(
        (gameId: number) => !isLfgOnly || !isSuccess || lookingIds.has(gameId),
        [isLfgOnly, isSuccess, lookingIds],
    );

    const setLfgFilter = useLfgFilterWriter();

    const toggleLfgFilter = useCallback(
        () => setLfgFilter(!isLfgOnly),
        [isLfgOnly, setLfgFilter],
    );

    /** Kept as a thin delegate: two shipped specs pin its exact semantics. */
    const clearLfgFilter = useCallback(
        () => setLfgFilter(false),
        [setLfgFilter],
    );

    return {
        isLfgOnly,
        matchesLfgFilter,
        clearLfgFilter,
        setLfgFilter,
        toggleLfgFilter,
    };
}
