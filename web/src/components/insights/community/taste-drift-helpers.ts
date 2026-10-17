import type { CommunityRadarResponseDto } from '@raid-ledger/contract';

/**
 * Pivots the flat per-week-per-axis drift series into Recharts-shaped
 * rows keyed by `weekStart`, selecting the top-3 axes by latest-week
 * mean score. Lives in its own file so the component module remains
 * Fast-Refresh-clean (react-refresh/only-export-components).
 */
export function reshape(driftSeries: CommunityRadarResponseDto['driftSeries']) {
    const weeks = Array.from(new Set(driftSeries.map((p) => p.weekStart))).sort();
    const latest = weeks[weeks.length - 1];
    const topAxes = driftSeries
        .filter((p) => p.weekStart === latest)
        .sort((a, b) => b.meanScore - a.meanScore)
        .slice(0, 3)
        .map((p) => p.axis);
    const rows = weeks.map((weekStart) => {
        const row: Record<string, string | number> = { weekStart };
        for (const axis of topAxes) {
            const p = driftSeries.find((x) => x.weekStart === weekStart && x.axis === axis);
            row[axis] = Math.round(p?.meanScore ?? 0);
        }
        return row;
    });
    return { weeks, topAxes, rows };
}
