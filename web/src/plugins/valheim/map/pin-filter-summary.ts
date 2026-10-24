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
    /** ROK-1946 D15: the scanned-portal layer's failure (a hub 404 is no layer, not an error). */
    portalsError: boolean;
    /** Portals the mod left out of the scan; > 0 appends the "not uploaded" line. */
    portalsOmitted: number;
    onRetryPortals: () => void;
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
    portalsError: 'Portals could not be loaded',
} as const;

/** D15: the omitted-portals line. */
export function portalsOmittedText(omitted: number): string {
    return `Some portals were not uploaded (${omitted}).`;
}

/** True when the portal layer failed for a reason other than the hub 404. */
export function portalLayerFailed(query: Pick<UseQueryResult, 'isError' | 'error'>): boolean {
    return query.isError && httpStatusOf(query.error) !== 404;
}
