/**
 * ROK-1525 — library filter predicates (player count + community ownership).
 *
 * Pure, client-side logic over rows the page already fetched (`playerCount` and
 * `ownerCount` ride every list DTO — no extra request, no contract change).
 *
 * Strict semantics (operator rulings, 2026-09-12):
 *   - The N control is the preset set 2 / 3 / 4 / 5+, exported once below so the
 *     chip row and the URL sanitizer cannot drift apart.
 *   - "supports N" means N falls INSIDE the game's IGDB `playerCount` min-max
 *     range, so a 4-player-minimum game is not an answer to "the two of us".
 *     `5+` is the open-ended tail: `max >= 5`, with no range to straddle.
 *   - `N own` means owned by AT LEAST N community members.
 *
 * NULL rulings — the two traps this module exists to pin:
 *   - The player predicate reads IGDB `playerCount` and NOTHING else. There is
 *     deliberately no fallback to the Co-Optimus online max: that field answers
 *     "how many can co-op", not "how many can this seat", and ROK-1402 already
 *     owns it under its own opposite rule. A game with no IGDB range therefore
 *     cannot satisfy "supports N" and is EXCLUDED while a player chip is active
 *     rather than guessed at — never silently, since the page renders a hint
 *     line whenever a predicate is active (the ROK-1402 precedent).
 *   - A missing `ownerCount` is a stale DTO that omitted the aggregate, i.e.
 *     UNKNOWN — not zero. It is likewise EXCLUDED while an owners chip is
 *     active, so "at least 2 own it" never answers with a row nobody has
 *     confirmed anybody owns.
 */

/** One preset chip. `openEnded` drops the upper bound (the `5+` tail). */
export interface PlayerCountPreset {
    key: string;
    label: string;
    /** The N in "supports N". */
    players: number;
    /** True for `5+`: match on `max >= players` with no min-side straddle. */
    openEnded: boolean;
}

/**
 * The 2 / 3 / 4 / 5+ chips — the SINGLE source of truth. The chip row, the URL
 * sanitizer and any badge-to-param mapping all read this array, so none of them
 * can disagree about whether `5plus` is a valid value.
 */
export const PLAYER_COUNT_PRESETS: readonly PlayerCountPreset[] = [
    { key: '2', label: '2', players: 2, openEnded: false },
    { key: '3', label: '3', players: 3, openEnded: false },
    { key: '4', label: '4', players: 4, openEnded: false },
    { key: '5plus', label: '5+', players: 5, openEnded: true },
] as const;

/** Valid values for the `players` URL param / chip state. */
export type PlayerPresetKey = (typeof PLAYER_COUNT_PRESETS)[number]['key'];

/** The URL sanitizer's guard: anything not in the const above is discarded. */
export function isPlayerPresetKey(value: string | null | undefined): value is PlayerPresetKey {
    return value != null && PLAYER_COUNT_PRESETS.some((preset) => preset.key === value);
}

/** Look up a preset by key, or null when the key is unknown. */
export function findPlayerPreset(key: string | null | undefined): PlayerCountPreset | null {
    return PLAYER_COUNT_PRESETS.find((preset) => preset.key === key) ?? null;
}

/**
 * Structural shape the predicates read. Deliberately narrower than
 * `GameDetailDto`: discover rows, search rows and stale Redis rows all satisfy
 * it, and every field may be null OR entirely absent.
 */
export interface LibraryFilterableGame {
    playerCount?: { min: number; max: number } | null;
    ownerCount?: number | null;
}

/** Active library predicates. An absent key is an inactive predicate. */
export interface LibraryFilterState {
    /** A key from `PLAYER_COUNT_PRESETS`; anything else is inactive. */
    players?: string;
    /** "owned by at least N"; undefined / 0 / NaN is inactive. */
    minOwners?: number;
}

/** No predicate active — the page's initial state and the "Clear all" target. */
export const EMPTY_LIBRARY_FILTERS: LibraryFilterState = {};

/** The numeric predicate is only active for a finite value of 1 or more. */
function isNumericActive(value: number | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Number of predicates currently narrowing the results (drives the badge). */
export function countActiveLibraryFilters(state: LibraryFilterState): number {
    const player = isPlayerPresetKey(state.players) ? 1 : 0;
    const owners = isNumericActive(state.minOwners) ? 1 : 0;
    return player + owners;
}

/** True when at least one library predicate is narrowing the results. */
export function hasActiveLibraryFilters(state: LibraryFilterState): boolean {
    return countActiveLibraryFilters(state) > 0;
}

/**
 * Does this game seat exactly the asked-for party size? A game with no IGDB
 * range cannot answer, so it fails the predicate (see the NULL ruling above).
 */
export function supportsPlayerCount(
    game: LibraryFilterableGame,
    preset: PlayerCountPreset,
): boolean {
    const range = game.playerCount;
    if (range == null) return false;
    if (preset.openEnded) return range.max >= preset.players;
    return range.min <= preset.players && range.max >= preset.players;
}

/**
 * Owned by at least `min` members. A missing count is UNKNOWN, not zero, so it
 * fails the predicate rather than being read as "nobody owns it".
 */
export function ownedByAtLeast(game: LibraryFilterableGame, min: number): boolean {
    const count = game.ownerCount;
    return typeof count === 'number' && Number.isFinite(count) && count >= min;
}

function matchesLibraryFilters(game: LibraryFilterableGame, state: LibraryFilterState): boolean {
    const preset = findPlayerPreset(state.players);
    if (preset !== null && !supportsPlayerCount(game, preset)) return false;
    if (isNumericActive(state.minOwners) && !ownedByAtLeast(game, state.minOwners)) return false;
    return true;
}

/** Intersection of every active predicate. Order-preserving, non-mutating. */
export function applyLibraryFilters<T extends LibraryFilterableGame>(
    games: readonly T[],
    state: LibraryFilterState,
): T[] {
    if (!hasActiveLibraryFilters(state)) return [...games];
    return games.filter((game) => matchesLibraryFilters(game, state));
}
