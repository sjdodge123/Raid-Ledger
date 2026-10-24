/**
 * ROK-1943 D15 — the pin filter's summary state (the toolbar line lane C2
 * renders) and the server layer's status. Also the ROK-1930 switch/bar shims
 * the current view still reads until lane C2 swaps in the panel.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { httpStatusOf } from '../../../lib/api/api-error';
import type { PinFilter } from './pin-filter';

/**
 * The cross-player layer: `idle` in this-character scope; `forbidden` = the
 * visitor 404 (D15 "visible to hub members", layer empty); `error` = anything
 * else (danger chip + Retry).
 */
export type PinLayerStatus = 'idle' | 'loading' | 'ready' | 'forbidden' | 'error';

export interface PinFilterSummary {
    /** Non-default sections (0..4) — the funnel badge. */
    activeCount: number;
    /** Pins drawn after filtering. */
    count: number;
    status: PinLayerStatus;
    /** The layer hit `VALHEIM_SERVER_PINS_CAP` — "Showing the first 2,000 pins…". */
    truncated: boolean;
    onRetry: () => void;
    /** "Clear filters" in the empty state — same as Clear all. */
    onClear: () => void;
}

/** The server layer's status for the summary line. */
export function layerStatus(query: Pick<UseQueryResult, 'isPending' | 'isError' | 'error'>, on: boolean): PinLayerStatus {
    if (!on) return 'idle';
    if (query.isError) return httpStatusOf(query.error) === 404 ? 'forbidden' : 'error';
    return query.isPending ? 'loading' : 'ready';
}

/** @deprecated ROK-1930 `PinFilterBar` props — gone with the bar in lane C2. */
export interface PinFilterBarState {
    scope: 'character' | 'server';
    count: number;
    loading: boolean;
    onClear: () => void;
}

const isDeathsOnly = (filter: PinFilter): boolean => filter.types?.size === 1 && filter.types.has('death');

/** @deprecated shims for the ROK-1930 "Death pins only" switch + bar (lane C2 deletes them). */
export const legacyBar = {
    controls: (filter: PinFilter, onDeathsOnly: (on: boolean) => void) =>
        ({ deathsOnly: isDeathsOnly(filter), onDeathsOnly }),
    bar: (summary: PinFilterSummary, filter: PinFilter): PinFilterBarState | null => (isDeathsOnly(filter)
        ? {
            scope: filter.players === 'character' ? 'character' : 'server',
            count: summary.count, loading: summary.status === 'loading', onClear: summary.onClear,
        }
        : null),
};
