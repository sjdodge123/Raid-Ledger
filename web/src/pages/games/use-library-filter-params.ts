/**
 * ROK-1525 — `players` / `owners` as URL state, modelled on the `lfg=1` filter
 * (`use-lfg-filter-param.ts`, ROK-1478) because the operator ruled the combined
 * library state is "URL-persisted the way ROK-1478's filter is".
 *
 * What this hook adds over slice 1's pure predicates: it is the single place
 * that decides whether a query string is ACTIVE. Every other surface — the chip
 * row, the clickable card badges — reads that decision instead of parsing the
 * URL again, so no two callers can disagree about whether `?players=5plus` is
 * valid.
 *
 * Two rules carried over from the `lfg` hook, both load-bearing:
 *   • Every write copies the PREVIOUS params (`applyLibraryParams`), never
 *     constructs a fresh `URLSearchParams`. `lfg`, `q`, `genre` and the sibling
 *     library param all have to survive each other's writes. Note the `lfg`
 *     writer deliberately deletes `q` (`use-lfg-filter-param.ts:61-70`) — that
 *     is because it swaps the page between two mutually exclusive VIEWS. These
 *     params only NARROW the view already on screen, so they drop nothing.
 *   • `{ replace: true }` in BOTH directions (ROK-1478 ambiguity A2): a chip row
 *     the user sweeps through must not stack history entries that Back then has
 *     to unwind one press at a time.
 *
 * Malformed input is INACTIVE, never empty: `players=99`, `players=abc`,
 * `owners=-1`, `owners=0` all read as "no filter". A hand-edited or stale URL
 * should show the whole Library, not a blank grid with no explanation.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    applyLibraryFilters,
    isPlayerPresetKey,
    matchesLibraryFilters,
    type LibraryFilterState,
    type LibraryFilterableGame,
    type PlayerPresetKey,
} from './library-filter.helpers';

/** The preset chip key — `2` | `3` | `4` | `5plus`. */
const PLAYERS_PARAM = 'players';
/** "owned by at least N members" — a positive integer or nothing. */
const OWNERS_PARAM = 'owners';

/** A param write: a string sets, `null` deletes. Absent keys are untouched. */
type LibraryParamPatch = Partial<Record<string, string | null>>;

export interface LibraryFilterParams {
    /** The sanitized preset key, or null while the param is absent/garbage. */
    playersFilter: PlayerPresetKey | null;
    /** The sanitized minimum owner count, or null while inactive. */
    minOwners: number | null;
    /** Slice 1's state object, ready to hand to any predicate consumer. */
    filters: LibraryFilterState;
    /** True while at least one of the two params is narrowing the results. */
    isLibraryFiltered: boolean;
    /** Slice 1's composed predicate; keeps everything while both are off. */
    matchesLibraryFilters: (game: LibraryFilterableGame) => boolean;
    /** The same predicate over a list — order-preserving, non-mutating. */
    filterLibraryRows: <T extends LibraryFilterableGame>(rows: readonly T[]) => T[];
    /** Write a preset key, or `null` to drop `players` and nothing else. */
    setPlayersFilter: (key: string | null) => void;
    /** Chip behaviour: the active key turns off, any other key swaps in. */
    togglePlayersFilter: (key: string) => void;
    /** Write a minimum owner count, or `null`/`0` to drop `owners`. */
    setMinOwners: (min: number | null) => void;
    /** Badge behaviour: the active count turns off, any other swaps in. */
    toggleMinOwners: (min: number) => void;
    /** Drop both library params, leaving `lfg` / `q` / genre in place. */
    clearLibraryFilters: () => void;
}

/** The preset key, or null — read from whichever params object is in hand. */
function readPlayersParam(params: URLSearchParams): PlayerPresetKey | null {
    const raw = params.get(PLAYERS_PARAM);
    return isPlayerPresetKey(raw) ? raw : null;
}

/** Only a positive integer is a valid owner floor; everything else is off. */
function isOwnersValue(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** The owner floor, or null. `-1`, `0`, `2.5` and `abc` all read as null. */
function readOwnersParam(params: URLSearchParams): number | null {
    const raw = params.get(OWNERS_PARAM);
    if (raw == null || raw.trim() === '') return null;
    const parsed = Number(raw);
    return isOwnersValue(parsed) ? parsed : null;
}

/**
 * Apply a patch to a COPY of the current params. Copying (rather than building
 * a fresh object) is what makes `lfg`, `q`, genre and the sibling library param
 * survive; a key absent from the patch is never touched at all.
 */
function applyLibraryParams(prev: URLSearchParams, patch: LibraryParamPatch): URLSearchParams {
    const next = new URLSearchParams(prev);
    for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === '') next.delete(key);
        else next.set(key, value);
    }
    return next;
}

/** The writers, split out to keep the exported hook inside its line budget. */
type LibraryFilterWriters = Pick<
    LibraryFilterParams,
    | 'setPlayersFilter'
    | 'togglePlayersFilter'
    | 'setMinOwners'
    | 'toggleMinOwners'
    | 'clearLibraryFilters'
>;

/**
 * Every writer resolves its target value INSIDE the updater, from the params it
 * is handed — never from a render-scoped `playersFilter`. That keeps each
 * callback's identity stable (its only dep is `setSearchParams`, so a chip row
 * of four buttons does not re-render on every URL change) and makes the toggles
 * self-evidently a function of the URL rather than of a captured closure.
 */
type WriteParams = (resolve: (prev: URLSearchParams) => LibraryParamPatch) => void;

/** The one `setSearchParams` call site — hence the one `{ replace: true }`. */
function useLibraryParamWrite(): WriteParams {
    const [, setSearchParams] = useSearchParams();
    return useCallback(
        (resolve) =>
            setSearchParams((prev) => applyLibraryParams(prev, resolve(prev)), {
                replace: true,
            }),
        [setSearchParams],
    );
}

function usePlayersWriters(
    write: WriteParams,
): Pick<LibraryFilterParams, 'setPlayersFilter' | 'togglePlayersFilter'> {
    const setPlayersFilter = useCallback(
        (key: string | null) =>
            write(() => ({ [PLAYERS_PARAM]: isPlayerPresetKey(key) ? key : null })),
        [write],
    );
    const togglePlayersFilter = useCallback(
        (key: string) =>
            write((prev) => ({
                [PLAYERS_PARAM]:
                    !isPlayerPresetKey(key) || readPlayersParam(prev) === key ? null : key,
            })),
        [write],
    );
    return { setPlayersFilter, togglePlayersFilter };
}

function useOwnersWriters(
    write: WriteParams,
): Pick<LibraryFilterParams, 'setMinOwners' | 'toggleMinOwners'> {
    const setMinOwners = useCallback(
        (min: number | null) =>
            write(() => ({ [OWNERS_PARAM]: isOwnersValue(min) ? String(min) : null })),
        [write],
    );
    const toggleMinOwners = useCallback(
        (min: number) =>
            write((prev) => ({
                [OWNERS_PARAM]:
                    !isOwnersValue(min) || readOwnersParam(prev) === min ? null : String(min),
            })),
        [write],
    );
    return { setMinOwners, toggleMinOwners };
}

function useLibraryFilterWriters(): LibraryFilterWriters {
    const write = useLibraryParamWrite();
    const clearLibraryFilters = useCallback(
        () => write(() => ({ [PLAYERS_PARAM]: null, [OWNERS_PARAM]: null })),
        [write],
    );
    return {
        ...usePlayersWriters(write),
        ...useOwnersWriters(write),
        clearLibraryFilters,
    };
}

/** Read/write `players` + `owners` and derive slice 1's composed predicate. */
export function useLibraryFilterParams(): LibraryFilterParams {
    const [searchParams] = useSearchParams();
    const playersFilter = readPlayersParam(searchParams);
    const minOwners = readOwnersParam(searchParams);

    const filters = useMemo<LibraryFilterState>(
        () => ({
            ...(playersFilter !== null ? { players: playersFilter } : {}),
            ...(minOwners !== null ? { minOwners } : {}),
        }),
        [playersFilter, minOwners],
    );

    const matches = useCallback(
        (game: LibraryFilterableGame) => matchesLibraryFilters(game, filters),
        [filters],
    );
    const filterLibraryRows = useCallback(
        <T extends LibraryFilterableGame>(rows: readonly T[]) =>
            applyLibraryFilters(rows, filters),
        [filters],
    );

    return {
        playersFilter,
        minOwners,
        filters,
        isLibraryFiltered: playersFilter !== null || minOwners !== null,
        matchesLibraryFilters: matches,
        filterLibraryRows,
        ...useLibraryFilterWriters(),
    };
}
