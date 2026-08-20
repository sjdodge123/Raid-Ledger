/**
 * ROK-1402 — sessionStorage-backed co-op filter state for the games library.
 *
 * Operator review 2026-08-20: opening a game's detail page and coming back must
 * not silently drop the filters. The page remounts on that round trip, so the
 * state is mirrored into sessionStorage (per-tab, cleared when the tab closes —
 * a filter set is a browsing session, not a durable preference).
 *
 * There is no generic storage-state hook in `web/src` today, and ROK-1400 is
 * adding the same persistence for Common Ground in parallel, so this stays
 * page-local rather than racing a shared abstraction into place.
 */
import { useCallback, useState } from 'react';
import { EMPTY_COOP_FILTERS, type CoopFilterState } from './coop-filter.helpers';

export const COOP_FILTERS_STORAGE_KEY = 'games-coop-filters';

const BOOLEAN_KEYS = ['couchCoop', 'lanCoop', 'splitscreen', 'campaignCoop'] as const;

/**
 * Rebuilds state from an untrusted JSON blob: only known keys with the right
 * primitive type survive, so a stale or hand-edited entry can never inject an
 * unexpected predicate shape into the filter pipeline.
 */
function sanitize(parsed: unknown): CoopFilterState {
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_COOP_FILTERS;
    const raw = parsed as Record<string, unknown>;
    const next: CoopFilterState = {};
    const min = raw.onlineMinPlayers;
    if (typeof min === 'number' && Number.isFinite(min) && min > 0) next.onlineMinPlayers = min;
    for (const key of BOOLEAN_KEYS) {
        if (raw[key] === true) next[key] = true;
    }
    return next;
}

/** Reads persisted filters. Any storage or parse failure falls back to empty. */
export function readStoredCoopFilters(): CoopFilterState {
    try {
        const raw = sessionStorage.getItem(COOP_FILTERS_STORAGE_KEY);
        return raw ? sanitize(JSON.parse(raw)) : EMPTY_COOP_FILTERS;
    } catch {
        return EMPTY_COOP_FILTERS;
    }
}

/** Co-op filter state that survives an unmount/remount within the tab. */
export function useCoopFilterState(): [CoopFilterState, (next: CoopFilterState) => void] {
    const [filters, setFilters] = useState<CoopFilterState>(readStoredCoopFilters);

    const update = useCallback((next: CoopFilterState) => {
        setFilters(next);
        try {
            sessionStorage.setItem(COOP_FILTERS_STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Private-mode / quota failures must never break filtering.
        }
    }, []);

    return [filters, update];
}
