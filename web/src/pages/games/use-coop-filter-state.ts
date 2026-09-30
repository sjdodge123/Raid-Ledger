/**
 * ROK-1402 — sessionStorage-backed co-op filter state for the games library.
 *
 * Operator review 2026-08-20: opening a game's detail page and coming back must
 * not silently drop the filters. The page remounts on that round trip, so the
 * state is mirrored into sessionStorage (per-tab, cleared when the tab closes —
 * a filter set is a browsing session, not a durable preference).
 *
 * TDB:316 — now a thin wrapper over the shared `useSessionState` (ROK-1400)
 * rather than a page-local copy of the same persistence. A stored blob that
 * fails to parse or validate is evicted by that hook.
 */
import { useSessionState } from '../../hooks/use-session-state';
import { EMPTY_COOP_FILTERS, type CoopFilterState } from './coop-filter.helpers';

const COOP_FILTERS_STORAGE_KEY = 'games-coop-filters';

const BOOLEAN_KEYS = ['couchCoop', 'lanCoop', 'splitscreen', 'campaignCoop'] as const;

/**
 * Rebuilds state from an untrusted JSON blob: only known keys with the right
 * primitive type survive, so a stale or hand-edited entry can never inject an
 * unexpected predicate shape into the filter pipeline. A non-object is
 * rejected outright.
 */
function validateCoopFilters(parsed: unknown): CoopFilterState | null {
    if (typeof parsed !== 'object' || parsed === null) return null;
    const raw = parsed as Record<string, unknown>;
    const next: CoopFilterState = {};
    const min = raw.onlineMinPlayers;
    if (typeof min === 'number' && Number.isFinite(min) && min > 0) next.onlineMinPlayers = min;
    for (const key of BOOLEAN_KEYS) {
        if (raw[key] === true) next[key] = true;
    }
    return next;
}

/** Co-op filter state that survives an unmount/remount within the tab. */
export function useCoopFilterState(): [CoopFilterState, (next: CoopFilterState) => void] {
    const { value, setValue } = useSessionState<CoopFilterState>(
        COOP_FILTERS_STORAGE_KEY,
        EMPTY_COOP_FILTERS,
        validateCoopFilters,
    );
    return [value, setValue];
}
