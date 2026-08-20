/**
 * ROK-1402 — co-op filter predicates for the games library page.
 *
 * Pure, client-side logic over rows the page already fetched (the `cooptimus*`
 * fields ride every list DTO — no extra request, no contract change).
 *
 * Strict semantics (operator, 2026-08-20): the effective online max is
 * `cooptimusOnlineMax` and nothing else — 0 included, null included. There is
 * deliberately **no IGDB `playerCount.max` fallback**: an IGDB lobby size counts
 * players, not co-op support, so a PvP-only title with a 100-player lobby must
 * never satisfy a co-op predicate. A game Co-Optimus has not answered for is
 * therefore EXCLUDED from every co-op predicate rather than guessed at — never
 * silently, since the page renders a hint line whenever a predicate is active.
 */

/**
 * Structural shape the predicates read. Deliberately narrower than
 * `GameDetailDto`: discover rows, search rows and stale Redis rows all satisfy
 * it, and every field may be null OR entirely absent.
 */
export interface CoopFilterableGame {
    cooptimusOnlineMax?: number | null;
    cooptimusCouchMax?: number | null;
    cooptimusLanMax?: number | null;
    cooptimusSplitscreen?: boolean | null;
    cooptimusCampaignCoop?: boolean | null;
    cooptimusSyncedAt?: string | null;
}

/**
 * True when any loaded game carries a Co-Optimus signal. Gates the visibility
 * of the four boolean mode toggles (operator decision 2026-08-20): until the
 * first sync lands, those toggles have no data to match and would only empty
 * the grid — so they stay hidden and self-activate the day data arrives.
 */
export function hasAnyCoopData(games: readonly CoopFilterableGame[]): boolean {
    return games.some(
        (g) =>
            g.cooptimusSyncedAt != null ||
            g.cooptimusOnlineMax != null ||
            g.cooptimusCouchMax != null ||
            g.cooptimusLanMax != null ||
            g.cooptimusSplitscreen != null ||
            g.cooptimusCampaignCoop != null,
    );
}

/** Active co-op predicates. `onlineMinPlayers` of undefined/0/NaN is inactive. */
export interface CoopFilterState {
    onlineMinPlayers?: number;
    couchCoop?: boolean;
    lanCoop?: boolean;
    splitscreen?: boolean;
    campaignCoop?: boolean;
}

/** No predicate active — the page's initial state and the "Clear all" target. */
export const EMPTY_COOP_FILTERS: CoopFilterState = {};

/** A local mode counts as "supported" only when it seats 2+ players. */
const SUPPORTED_LOCAL_MIN = 2;

const BOOLEAN_KEYS = ['couchCoop', 'lanCoop', 'splitscreen', 'campaignCoop'] as const;

/** The Co-Optimus online max, or null when Co-Optimus has no answer. */
export function effectiveOnlineMax(game: CoopFilterableGame): number | null {
    const cooptimus = game.cooptimusOnlineMax;
    return typeof cooptimus === 'number' ? cooptimus : null;
}

/** The numeric predicate is only active for a finite value of 1 or more. */
function isNumericActive(value: number | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Number of predicates currently narrowing the results (drives the badge). */
export function countActiveCoopFilters(state: CoopFilterState): number {
    const numeric = isNumericActive(state.onlineMinPlayers) ? 1 : 0;
    return numeric + BOOLEAN_KEYS.filter((key) => state[key] === true).length;
}

/** True when at least one co-op predicate is narrowing the results. */
export function hasActiveCoopFilters(state: CoopFilterState): boolean {
    return countActiveCoopFilters(state) > 0;
}

function supportsLocalMode(max: number | null | undefined): boolean {
    return typeof max === 'number' && max >= SUPPORTED_LOCAL_MIN;
}

function matchesOnlineMin(game: CoopFilterableGame, min: number | undefined): boolean {
    if (!isNumericActive(min)) return true;
    const max = effectiveOnlineMax(game);
    return max !== null && max >= min;
}

function matchesCoopFilters(game: CoopFilterableGame, state: CoopFilterState): boolean {
    if (!matchesOnlineMin(game, state.onlineMinPlayers)) return false;
    if (state.couchCoop === true && !supportsLocalMode(game.cooptimusCouchMax)) return false;
    if (state.lanCoop === true && !supportsLocalMode(game.cooptimusLanMax)) return false;
    if (state.splitscreen === true && game.cooptimusSplitscreen !== true) return false;
    if (state.campaignCoop === true && game.cooptimusCampaignCoop !== true) return false;
    return true;
}

/** Intersection of every active predicate. Order-preserving, non-mutating. */
export function applyCoopFilters<T extends CoopFilterableGame>(
    games: readonly T[],
    state: CoopFilterState,
): T[] {
    if (!hasActiveCoopFilters(state)) return [...games];
    return games.filter((game) => matchesCoopFilters(game, state));
}
