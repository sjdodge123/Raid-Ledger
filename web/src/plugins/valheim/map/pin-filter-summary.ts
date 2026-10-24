/**
 * ROK-1943 D15 — the pin filter's summary state (the toolbar line lane C2
 * renders) and the server layer's status.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import { httpStatusOf } from '../../../lib/api/api-error';

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

/** D15 summary copy (the toolbar line). */
export const PIN_SUMMARY_TEXT = {
    loading: 'Loading pins…',
    forbidden: "Other players' pins are visible to hub members.",
    error: 'Pins could not be loaded',
    empty: 'No pins match these filters.',
    truncated: 'Showing the first 2,000 pins — narrow the filters.',
} as const;
