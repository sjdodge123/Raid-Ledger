import { getVisualGroup, getMergeColor } from './game-time-grid.utils';
import type { HeatmapCellData } from './game-time-grid.types';

/** Computes the vertical merge rounding class for a cell */
export function computeRounding(
    group: string, aboveGroup: string | null, belowGroup: string | null,
): string {
    const sameAbove = aboveGroup === group;
    const sameBelow = belowGroup === group;
    if (sameAbove && sameBelow) return '';
    if (sameAbove) return 'rounded-b-sm';
    if (sameBelow) return 'rounded-t-sm';
    return 'rounded-sm';
}

/** Computes the visual group for a neighbor cell, or null if out of range */
export function neighborGroup(
    dayIndex: number, neighborHour: number, rangeStart: number, rangeEnd: number,
    getSlotStatus: (d: number, h: number) => string | undefined,
    eventCellSet: Set<string>,
): string | null {
    if (neighborHour < rangeStart || neighborHour >= rangeEnd) return null;
    return getVisualGroup(getSlotStatus(dayIndex, neighborHour), eventCellSet.has(`${dayIndex}:${neighborHour}`));
}

/** Builds the box-shadow array for a grid cell */
export function computeShadows(
    sameAbove: boolean, group: string, isInteractive: boolean,
    dist: number, isHovered: boolean, locked: boolean, isErase: boolean,
): string[] {
    const shadows: string[] = [];
    if (sameAbove) shadows.push(`0 -1px 0 0 ${getMergeColor(group)}`);
    if (isInteractive && dist > 0 && dist <= 4) {
        shadows.push(`inset 0 0 0 0.5px rgba(var(--gt-proximity-line), ${(0.28 - (dist - 1) * 0.06).toFixed(2)})`);
    }
    if (isHovered && isInteractive) {
        if (locked) {
            shadows.push(`0 0 0 1.5px rgba(var(--gt-proximity-line), 0.5)`);
            shadows.push(`0 0 10px 1px rgba(var(--gt-proximity-line), 0.25)`);
        } else {
            const ringColor = isErase ? 'rgba(248, 113, 113, 0.9)' : 'rgba(52, 211, 153, 0.95)';
            shadows.push(`0 0 0 2px ${ringColor}`);
            shadows.push(isErase ? '0 0 16px 2px rgba(248, 113, 113, 0.55)' : '0 0 16px 2px rgba(52, 211, 153, 0.6)');
        }
    }
    return shadows;
}

/** True once the poll aggregate supplies the freshness counts (ROK-1560). */
function hasFreshnessModel(heatmapData: HeatmapCellData): boolean {
    return heatmapData.stale !== undefined || heatmapData.unknown !== undefined;
}

/** Members whose template covers the cell, fresh or stale — "someone is known here". */
function knownCount(heatmapData: HeatmapCellData): number {
    return heatmapData.available + (heatmapData.stale ?? 0);
}

/**
 * Computes the heatmap background color for a cell, or undefined if no data.
 * ROK-1560 (softened 2026-09-15, operator ruling): the fill counts everyone
 * whose template covers the cell, but its alpha scales with the FRESH share —
 * a cell covered only by stale members draws at half strength, a fully fresh
 * cell at full strength. A cell nobody covers has no fill (its hatch says why).
 * Legacy aggregates (events) keep the old colour ramp unchanged.
 */
export function computeHeatmapBg(
    heatmapData: HeatmapCellData | undefined,
): string | undefined {
    if (!heatmapData) return undefined;
    const freshness = hasFreshnessModel(heatmapData);
    const known = freshness ? knownCount(heatmapData) : heatmapData.available;
    if (freshness && known === 0) return undefined;
    const intensity = known / heatmapData.total;
    const certainty = freshness ? 0.5 + 0.5 * (heatmapData.available / known) : 1;
    const alpha = (base: number): string => (base * certainty).toFixed(2);
    if (intensity >= 1.0) return `rgba(34, 197, 94, ${alpha(0.3 + intensity * 0.35)})`;
    if (intensity > 0.5) return `rgba(234, 179, 8, ${alpha(0.25 + intensity * 0.35)})`;
    return `rgba(239, 68, 68, ${alpha(0.2 + intensity * 0.35)})`;
}

/**
 * Computes the diagonal hatch for a cell where NOBODY is known (ROK-1560,
 * softened 2026-09-15): no fresh and no stale template covers it, and at least
 * one member has no game time at all. Stale coverage is a lighter fill, not a
 * hatch. Token-only: `--color-muted` via `color-mix`, so all schemes repaint it.
 */
export function computeHeatmapHatch(
    heatmapData: HeatmapCellData | undefined,
): string | undefined {
    if (!heatmapData) return undefined;
    if (!hasFreshnessModel(heatmapData) || knownCount(heatmapData) > 0) return undefined;
    const uncertain = heatmapData.unknown ?? 0;
    if (uncertain <= 0) return undefined;
    const ratio = Math.min(uncertain / Math.max(heatmapData.total, uncertain), 1);
    const strength = Math.round(20 + ratio * 40);
    return `repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-muted) ${strength}%, transparent) 0 2px, transparent 2px 5px)`;
}

/**
 * Cell label/tooltip copy (ROK-1560, ROK-1584). Reads
 * `3 free · 2 stale · 1 busy · 4 unknown` once the poll aggregate supplies the
 * freshness counts — the stale and busy parts only when non-zero — and keeps
 * the legacy `N of M players available` copy for aggregates that omit them
 * (events), busy count or not.
 */
export function computeHeatmapLabel(
    heatmapData: HeatmapCellData | undefined,
): string | undefined {
    if (!heatmapData) return undefined;
    if (!hasFreshnessModel(heatmapData)) {
        return `${heatmapData.available} of ${heatmapData.total} players available`;
    }
    const stale = heatmapData.stale ?? 0;
    const busy = heatmapData.busy ?? 0;
    const staleCopy = stale > 0 ? ` · ${stale} stale` : '';
    const busyCopy = busy > 0 ? ` · ${busy} busy` : '';
    return `${heatmapData.available} free${staleCopy}${busyCopy} · ${heatmapData.unknown ?? 0} unknown`;
}

/** Computes cursor and conditional classes for a grid cell */
export function computeCellClasses(
    compact: boolean | undefined, rounding: string, cellClasses: string,
    heatmapBg: string | undefined, canInteract: boolean, clickable: boolean,
    locked: boolean, past: boolean, hasNextWeek: boolean,
    isHovered: boolean, isInteractive: boolean,
): string {
    const cursorClass = canInteract || clickable ? 'cursor-pointer' : locked ? 'cursor-not-allowed' : '';
    const pastClass = past && hasNextWeek && !isHovered ? 'opacity-60' : '';
    const hoverClass = isHovered && (isInteractive || clickable) ? 'z-10 relative' : '';
    return `${compact ? 'h-4' : 'h-5'} ${rounding} transition-colors ${heatmapBg ? '' : cellClasses} ${cursorClass} ${pastClass} ${hoverClass}`;
}

/** Builds the inline style object for a grid cell */
export function computeCellStyle(
    shadows: string[], heatmapBg: string | undefined, heatmapHatch?: string | undefined,
): React.CSSProperties | undefined {
    const obj: React.CSSProperties = {
        ...(shadows.length ? { boxShadow: shadows.join(', ') } : {}),
        ...(heatmapBg ? { backgroundColor: heatmapBg } : {}),
        ...(heatmapHatch ? { backgroundImage: heatmapHatch } : {}),
    };
    return Object.keys(obj).length ? obj : undefined;
}
