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
/** The games page's free-text search param — mutually exclusive with `lfg=1`. */
const SEARCH_PARAM = 'q';

export interface LfgFilterParam {
    /** True only for `?lfg=1`. */
    isLfgOnly: boolean;
    /** Keeps games with a live intent while active; keeps all while inactive. */
    matchesLfgFilter: (gameId: number) => boolean;
    /**
     * Drop `lfg` and nothing else — search/genre params must survive.
     *
     * No production caller since ROK-1478 absorbed the ✕ into the toggle. It is
     * kept because `use-lfg-filter-param.test.ts:139-163` pins its exact
     * semantics, and those cases are the regression net for "dismissing the
     * filter must not drop the rest of the query string".
     */
    clearLfgFilter: () => void;
    /**
     * Write or drop `lfg=1`. Turning it ON also drops `q` (A5); turning it OFF
     * leaves every other search param in place.
     *
     * Also has no production caller — the chip only ever toggles. Kept as the
     * directional primitive `toggleLfgFilter` and `clearLfgFilter` are both
     * expressed in, and pinned directly by its own tests.
     */
    setLfgFilter: (on: boolean) => void;
    /** Flip the filter — the toggle chip's only action (ROK-1478 AC1). */
    toggleLfgFilter: () => void;
}

/** True only for `lfg=1` — read from whichever params object is in hand. */
function readsAsOn(params: URLSearchParams): boolean {
    return params.get(PARAM) === ACTIVE_VALUE;
}

/**
 * Add or drop `lfg` on a COPY of the current params.
 *
 * Turning the filter ON also drops `q` (spec ambiguity A5, Lead ruling):
 * `games-page.tsx:151-157` renders the looking grid OR the search results,
 * never both, so a URL carrying `?q=…&lfg=1` would encode two mutually
 * exclusive views and silently render only one of them. Turning the filter OFF
 * leaves `q` — and every other param — exactly where it was.
 */
function applyLfgParam(prev: URLSearchParams, on: boolean): URLSearchParams {
    const next = new URLSearchParams(prev);
    if (on) {
        next.set(PARAM, ACTIVE_VALUE);
        next.delete(SEARCH_PARAM);
    } else {
        next.delete(PARAM);
    }
    return next;
}

/** The two writers, so `useLfgFilterParam` stays inside its 30-line budget. */
interface LfgFilterWriter {
    setLfgFilter: (on: boolean) => void;
    toggleLfgFilter: () => void;
}

/**
 * The writer half, split out to keep `useLfgFilterParam` under the 30-line
 * function budget.
 *
 * `replace` in BOTH directions (spec ROK-1478 ambiguity A2): toggling a view
 * filter should not stack history entries the Back button then has to walk
 * back out of one press at a time.
 *
 * The target state is resolved INSIDE the updater from the params it is handed,
 * never from a render-scoped `isLfgOnly`. That keeps `toggleLfgFilter`'s
 * identity stable across renders (its only dep is `setSearchParams`) and makes
 * the flip self-evidently a function of the URL rather than of whatever the
 * closure happened to capture.
 */
function useLfgFilterWriter(): LfgFilterWriter {
    const [, setSearchParams] = useSearchParams();
    const write = useCallback(
        (resolve: (prev: URLSearchParams) => boolean) =>
            setSearchParams((prev) => applyLfgParam(prev, resolve(prev)), {
                replace: true,
            }),
        [setSearchParams],
    );
    const setLfgFilter = useCallback((on: boolean) => write(() => on), [write]);
    const toggleLfgFilter = useCallback(
        () => write((prev) => !readsAsOn(prev)),
        [write],
    );
    return { setLfgFilter, toggleLfgFilter };
}

/** Read/write the `lfg` search param and derive the matching predicate. */
export function useLfgFilterParam(): LfgFilterParam {
    const [searchParams] = useSearchParams();
    const { data, isSuccess } = useLfgGroups();

    const isLfgOnly = readsAsOn(searchParams);

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

    const { setLfgFilter, toggleLfgFilter } = useLfgFilterWriter();

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
