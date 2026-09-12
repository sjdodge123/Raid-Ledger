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
import { useSearchParamWrite } from './use-search-param-write';
import {
    applyLibraryFilters,
    isPlayerPresetKey,
    matchesLibraryFilters,
    type LibraryFilterState,
    type LibraryFilterableGame,
    type PlayerPresetKey,
} from './library-filter.helpers';
import { isGenreFilterKey } from './games-constants';

/** The preset chip key — `2` | `3` | `4` | `5plus`. */
const PLAYERS_PARAM = 'players';
/** "owned by at least N members" — a positive integer or nothing. */
const OWNERS_PARAM = 'owners';
/**
 * The genre chip row, as a comma-joined list of `GENRE_FILTERS` keys (slice 5).
 * It was the last member of the combined filter state still held in `useState`,
 * so a shared link reproduced every OTHER narrowing and silently dropped this
 * one. It lives here rather than in a parallel hook so it shares the
 * copy-previous-params writer and cannot clobber `lfg` / `players` / `owners`.
 */
const GENRES_PARAM = 'genres';

/** A param write: a string sets, `null` deletes. Absent keys are untouched. */
type LibraryParamPatch = Partial<Record<string, string | null>>;

export interface LibraryFilterParams {
    /** The sanitized preset key, or null while the param is absent/garbage. */
    playersFilter: PlayerPresetKey | null;
    /** The sanitized minimum owner count, or null while inactive. */
    minOwners: number | null;
    /** The selected genre keys. Empty is the "All" state, not "no genres". */
    selectedGenres: Set<string>;
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
    /** Replace the genre selection; the empty set DELETES `genres`. */
    setSelectedGenres: (next: Set<string>) => void;
    /** Drop both library params, leaving `lfg` / `q` / genres in place. */
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
 * The selected genre keys, in URL order, deduped and narrowed to keys that
 * `GENRE_FILTERS` actually defines. `genres=`, `genres=wargame` and a missing
 * param all read as the empty set — i.e. "All". An unknown key is IGNORED
 * rather than surfaced as a phantom selection no chip could then clear.
 *
 * Takes the RAW string rather than the params object so the caller can memoize
 * on it: `useSearchParams` returns a fresh instance every render, so a Set
 * derived from the object identity would rebuild (and re-render every genre
 * consumer) on each pass.
 */
function parseGenreKeys(raw: string | null): string[] {
    if (raw == null) return [];
    const keys = new Set<string>();
    for (const part of raw.split(',')) {
        const key = part.trim();
        if (isGenreFilterKey(key)) keys.add(key);
    }
    return [...keys];
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
    | 'setSelectedGenres'
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

/**
 * Every write goes through the shared `useSearchParamWrite` (ROK-1525 P2-3), so
 * the patch is applied to the params most recently WRITTEN — not to the copy
 * this render captured. Two chips activated inside one tick therefore compose
 * instead of the second dropping the first, across hook instances as well as
 * within one. `{ replace: true }` lives in that shared writer.
 */
function useLibraryParamWrite(): WriteParams {
    const write = useSearchParamWrite();
    return useCallback(
        (resolve) => write((prev) => applyLibraryParams(prev, resolve(prev))),
        [write],
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

/**
 * The genre row writes a whole selection at once (both entry points hand over a
 * new Set), so there is no per-key toggle here — the chip row and the bottom
 * sheet each compute the next set and this just serializes it.
 */
function useGenresWriter(write: WriteParams): Pick<LibraryFilterParams, 'setSelectedGenres'> {
    const setSelectedGenres = useCallback(
        (next: Set<string>) => {
            const keys = [...next].filter(isGenreFilterKey);
            write(() => ({ [GENRES_PARAM]: keys.length > 0 ? keys.join(',') : null }));
        },
        [write],
    );
    return { setSelectedGenres };
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
        ...useGenresWriter(write),
        clearLibraryFilters,
    };
}

/** The genre Set, memoized on the RAW param so its identity stays stable. */
function useSelectedGenres(searchParams: URLSearchParams): Set<string> {
    const genresRaw = searchParams.get(GENRES_PARAM);
    return useMemo(() => new Set(parseGenreKeys(genresRaw)), [genresRaw]);
}

/** Slice 1's predicates, bound to the current filter state. */
function useLibraryPredicates(
    filters: LibraryFilterState,
): Pick<LibraryFilterParams, 'matchesLibraryFilters' | 'filterLibraryRows'> {
    const matches = useCallback(
        (game: LibraryFilterableGame) => matchesLibraryFilters(game, filters),
        [filters],
    );
    const filterLibraryRows = useCallback(
        <T extends LibraryFilterableGame>(rows: readonly T[]) =>
            applyLibraryFilters(rows, filters),
        [filters],
    );
    return { matchesLibraryFilters: matches, filterLibraryRows };
}

/** Read/write `players` + `owners` + `genres` and derive slice 1's predicate. */
export function useLibraryFilterParams(): LibraryFilterParams {
    const [searchParams] = useSearchParams();
    const playersFilter = readPlayersParam(searchParams);
    const minOwners = readOwnersParam(searchParams);
    const selectedGenres = useSelectedGenres(searchParams);

    const filters = useMemo<LibraryFilterState>(
        () => ({
            ...(playersFilter !== null ? { players: playersFilter } : {}),
            ...(minOwners !== null ? { minOwners } : {}),
        }),
        [playersFilter, minOwners],
    );

    return {
        playersFilter,
        minOwners,
        selectedGenres,
        filters,
        // Genre is deliberately NOT part of this flag, and `clearLibraryFilters`
        // deliberately leaves `genres` alone: both drive the player/owner chip
        // row's "rows without player data are hidden" hint, which says nothing
        // true about a genre narrowing.
        isLibraryFiltered: playersFilter !== null || minOwners !== null,
        ...useLibraryPredicates(filters),
        ...useLibraryFilterWriters(),
    };
}
