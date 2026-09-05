/**
 * Scale + formatting for the speed gauge (ROK-1374). Kept apart from the
 * component so the file that renders it exports components only.
 */

/** Fraction of the sweep a figure fills: linear to 1 Mbps, then log10 to 100. */
export function gaugeFraction(mbps: number | null): number {
    if (mbps === null || !Number.isFinite(mbps) || mbps <= 0) return 0;
    if (mbps <= 1) return mbps / 6;
    return 1 / 6 + (5 / 6) * Math.min(1, Math.log10(mbps) / 2);
}

/** The centre figure, one decimal; an em dash until the first sample lands. */
export function formatMbps(mbps: number | null): string {
    return mbps === null ? '—' : mbps.toFixed(1);
}
